"""
CrowdSense AI - Video Processor Test Suite
Tests line crossing detection, entry/exit directional logic,
duplicate count prevention, error handling, synthetic tracking,
and non-blocking FastAPI video endpoints.
"""

import os
import time
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import database
from backend.counter import OccupancyCounter
from backend.main import app, counter, video_manager
from backend.video_processor import (
    LineCrossingCounter,
    TrackState,
    VideoJobManager,
    VideoProcessor,
    VirtualLine,
)


@pytest.fixture
def temp_db(tmp_path):
    """Provides an isolated SQLite database path for unit testing."""
    db_file = str(tmp_path / "test_video_crowdsense.db")
    database.init_db(db_file)
    return db_file


@pytest.fixture
def test_counter(temp_db):
    """Provides a fresh OccupancyCounter instance connected to the test database."""
    return OccupancyCounter(capacity=100, db_path=temp_db)


@pytest.fixture
def horizontal_line():
    """A horizontal line across a 640x480 frame at y=240."""
    return VirtualLine(pt1=(0, 240), pt2=(640, 240), margin=5.0)


@pytest.fixture
def vertical_line():
    """A vertical line down a 640x480 frame at x=320."""
    return VirtualLine(pt1=(320, 0), pt2=(320, 480), margin=5.0)


# ============================================================================
# Unit Tests: VirtualLine Geometry & Deadzone
# ============================================================================

def test_virtual_line_geometry(horizontal_line):
    """Verify signed distance and side detection relative to a horizontal line."""
    # Point well above the line (y=200, line at y=240) -> side -1
    assert horizontal_line.side_of_line((320, 200)) == -1

    # Point well below the line (y=300, line at y=240) -> side +1
    assert horizontal_line.side_of_line((320, 300)) == 1

    # Point within deadzone margin (240 +- 5) -> side 0
    assert horizontal_line.side_of_line((320, 242)) == 0
    assert horizontal_line.side_of_line((320, 238)) == 0


def test_vertical_line_geometry(vertical_line):
    """Verify signed distance and side detection relative to a vertical line."""
    # Point to the left of the line (x=200, line at x=320) -> side +1
    assert vertical_line.side_of_line((200, 240)) == 1

    # Point to the right of the line (x=400, line at x=320) -> side -1
    assert vertical_line.side_of_line((400, 240)) == -1

    # Point in deadzone margin
    assert vertical_line.side_of_line((322, 240)) == 0


# ============================================================================
# Unit Tests: Line Crossing Direction (Synthetic Tracking)
# ============================================================================

def test_entry_crossing_downward(horizontal_line, test_counter):
    """Verify that moving downward across a horizontal line triggers an entry."""
    counter_engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="down",
        debounce_frames=5,
        counter=test_counter,
        point_mode="center",
    )

    # Frame 1: Person (ID 1) starts above the line (y=150)
    evt1 = counter_engine.update(track_id=1, bbox=(300, 140, 340, 160), frame_idx=1)
    assert evt1 is None
    assert test_counter.current_occupancy == 0

    # Frame 2: Person moves downward across the line (y=300)
    evt2 = counter_engine.update(track_id=1, bbox=(300, 290, 340, 310), frame_idx=2)
    assert evt2 == "entry"
    assert counter_engine.total_entries == 1
    assert counter_engine.total_exits == 0
    assert test_counter.current_occupancy == 1
    assert test_counter.total_entries == 1


def test_exit_crossing_upward(horizontal_line, test_counter):
    """Verify that moving upward across a horizontal line triggers an exit."""
    # Pre-populate counter with 2 people inside
    test_counter.record_entry(count=2)
    assert test_counter.current_occupancy == 2

    counter_engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="down",
        debounce_frames=5,
        counter=test_counter,
        point_mode="center",
    )

    # Frame 1: Person (ID 2) starts below the line (y=320)
    evt1 = counter_engine.update(track_id=2, bbox=(300, 310, 340, 330), frame_idx=1)
    assert evt1 is None

    # Frame 2: Person moves upward across the line (y=180)
    evt2 = counter_engine.update(track_id=2, bbox=(300, 170, 340, 190), frame_idx=2)
    assert evt2 == "exit"
    assert counter_engine.total_exits == 1
    assert test_counter.current_occupancy == 1
    assert test_counter.total_exits == 1


def test_configurable_entry_direction_up(horizontal_line, test_counter):
    """Verify that inverted entry_direction ('up') treats upward movement as entry."""
    counter_engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="up",
        debounce_frames=5,
        counter=test_counter,
        point_mode="center",
    )

    # Move from below (y=300) to above (y=150) -> should be ENTRY under 'up' direction
    counter_engine.update(track_id=5, bbox=(300, 290, 340, 310), frame_idx=1)
    evt = counter_engine.update(track_id=5, bbox=(300, 140, 340, 160), frame_idx=2)
    assert evt == "entry"
    assert test_counter.current_occupancy == 1

    # Move from above (y=150) to below (y=300) -> should be EXIT under 'up' direction
    counter_engine.update(track_id=6, bbox=(200, 140, 240, 160), frame_idx=3)
    evt_exit = counter_engine.update(track_id=6, bbox=(200, 290, 240, 310), frame_idx=4)
    assert evt_exit == "exit"


def test_vertical_line_crossing(vertical_line, test_counter):
    """Verify crossing detection across a vertical line (moving left to right)."""
    counter_engine = LineCrossingCounter(
        line=vertical_line,
        entry_direction="right",
        debounce_frames=5,
        counter=test_counter,
        point_mode="center",
    )

    # Frame 1: Person on left side (x=250)
    counter_engine.update(track_id=10, bbox=(240, 200, 260, 280), frame_idx=1)

    # Frame 2: Person moves to right side (x=380)
    evt = counter_engine.update(track_id=10, bbox=(370, 200, 390, 280), frame_idx=2)
    assert evt == "entry"
    assert test_counter.current_occupancy == 1


# ============================================================================
# Unit Tests: Duplicate Count Prevention & Debounce
# ============================================================================

def test_duplicate_prevention_during_single_crossing(horizontal_line, test_counter):
    """Verify that a person does not trigger multiple counts while traversing across the line."""
    counter_engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="down",
        debounce_frames=10,
        counter=test_counter,
        point_mode="center",
    )

    # Multi-frame step-by-step crossing: y = 200 -> 220 -> 238 (deadzone) -> 242 (deadzone) -> 260 -> 280 -> 300
    y_trajectory = [200, 220, 238, 242, 260, 280, 300]
    events = []
    for frame_idx, y in enumerate(y_trajectory, start=1):
        evt = counter_engine.update(track_id=1, bbox=(300, y - 20, 340, y + 20), frame_idx=frame_idx)
        if evt:
            events.append(evt)

    # Exactly one entry event must be recorded
    assert events == ["entry"]
    assert counter_engine.total_entries == 1
    assert test_counter.current_occupancy == 1


def test_duplicate_prevention_jitter_and_oscillation(horizontal_line, test_counter):
    """Verify boundary oscillation within debounce period does not trigger multiple counts."""
    counter_engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="down",
        debounce_frames=15,
        counter=test_counter,
        point_mode="center",
    )

    # Person crosses down (Entry) at frame 10
    counter_engine.update(track_id=1, bbox=(300, 180, 340, 220), frame_idx=1)
    evt1 = counter_engine.update(track_id=1, bbox=(300, 270, 340, 310), frame_idx=10)
    assert evt1 == "entry"
    assert test_counter.current_occupancy == 1

    # Person rapidly oscillates back and forth at frames 11, 12, 13 (within debounce window)
    evt2 = counter_engine.update(track_id=1, bbox=(300, 180, 340, 220), frame_idx=11)
    evt3 = counter_engine.update(track_id=1, bbox=(300, 270, 340, 310), frame_idx=12)
    evt4 = counter_engine.update(track_id=1, bbox=(300, 180, 340, 220), frame_idx=13)

    assert evt2 is None
    assert evt3 is None
    assert evt4 is None
    assert counter_engine.total_entries == 1
    assert counter_engine.total_exits == 0

    # After debounce window passes (frame 30 > 10 + 15), moving back up triggers a valid exit
    evt5 = counter_engine.update(track_id=1, bbox=(300, 180, 340, 220), frame_idx=30)
    assert evt5 == "exit"
    assert counter_engine.total_exits == 1
    assert test_counter.current_occupancy == 0


def test_deadzone_hovering_prevents_false_crossings(horizontal_line, test_counter):
    """Verify that moving solely within the deadzone margin never triggers an event."""
    counter_engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="down",
        debounce_frames=5,
        counter=test_counter,
        point_mode="center",
    )

    # Hover around y=240 (+- 3 px, well within margin of 5)
    for frame_idx, y in enumerate([240, 242, 239, 241, 238, 243], start=1):
        evt = counter_engine.update(track_id=8, bbox=(300, y - 20, 340, y + 20), frame_idx=frame_idx)
        assert evt is None

    assert counter_engine.total_entries == 0
    assert counter_engine.total_exits == 0


def test_multiple_tracks_tracked_independently(horizontal_line, test_counter):
    """Verify that multiple people with distinct tracking IDs are counted independently."""
    counter_engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="down",
        debounce_frames=5,
        counter=test_counter,
        point_mode="center",
    )

    # Three people enter
    for tid in [1, 2, 3]:
        counter_engine.update(track_id=tid, bbox=(100 * tid, 150, 100 * tid + 40, 190), frame_idx=1)
        evt = counter_engine.update(track_id=tid, bbox=(100 * tid, 290, 100 * tid + 40, 330), frame_idx=2)
        assert evt == "entry"

    assert test_counter.current_occupancy == 3
    assert test_counter.peak_occupancy == 3

    # Person 2 exits after debounce
    counter_engine.update(track_id=2, bbox=(200, 150, 240, 190), frame_idx=10)
    assert test_counter.current_occupancy == 2
    assert test_counter.total_exits == 1
    assert test_counter.peak_occupancy == 3


# ============================================================================
# Unit Tests: Error Handling & Missing Values
# ============================================================================

def test_missing_video_file_raises_error(test_counter):
    """Verify that attempting to process a non-existent video file raises FileNotFoundError."""
    processor = VideoProcessor(counter=test_counter)
    with pytest.raises(FileNotFoundError):
        processor.process_video("non_existent_video_path.mp4")


def test_invalid_video_file_raises_error(tmp_path, test_counter):
    """Verify that attempting to process a corrupt/empty file raises ValueError."""
    fake_file = tmp_path / "corrupt.mp4"
    fake_file.write_text("not a real video file content")

    processor = VideoProcessor(counter=test_counter)
    with pytest.raises(ValueError):
        processor.process_video(str(fake_file))


def test_missing_tracking_ids_handled_gracefully(horizontal_line, test_counter):
    """Verify that None or invalid tracking IDs are safely ignored without crashing."""
    counter_engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="down",
        counter=test_counter,
    )

    # Missing ID (None)
    assert counter_engine.update(track_id=None, bbox=(100, 100, 140, 140), frame_idx=1) is None
    # Negative ID (-1)
    assert counter_engine.update(track_id=-1, bbox=(100, 100, 140, 140), frame_idx=1) is None
    assert test_counter.current_occupancy == 0


def test_synthetic_video_processing_run(tmp_path, test_counter):
    """
    Creates a brief synthetic video with OpenCV VideoWriter and verifies
    that VideoProcessor runs frame-by-frame, completes, and cleans up resources.
    """
    video_path = str(tmp_path / "synthetic_test.mp4")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(video_path, fourcc, 10.0, (320, 240))

    # Write 8 blank frames
    for _ in range(8):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        out.write(frame)
    out.release()

    processor = VideoProcessor(counter=test_counter, model_name="yolov8n.pt")
    summary = processor.process_video(video_path=video_path, max_frames=5)

    assert summary["status"] == "completed"
    assert summary["processed_frames"] == 5
    assert summary["entries_detected"] == 0
    assert summary["exits_detected"] == 0
    assert not processor.is_running


# ============================================================================
# API Endpoint Integration Tests (Non-Blocking)
# ============================================================================

@pytest.fixture
def api_client(temp_db):
    """Provides a TestClient connected to a clean counter and database."""
    original_db = counter.db_path
    counter.db_path = temp_db
    database.init_db(temp_db)
    counter.reset(clear_db=True)
    with TestClient(app) as client:
        yield client
    counter.reset(clear_db=True)
    counter.db_path = original_db
    counter.restore_state()



def test_api_video_status_initial_state(api_client):
    """Verify GET /video/status returns initial idle state."""
    res = api_client.get("/video/status")
    assert res.status_code == 200
    data = res.json()
    assert "status" in data
    assert "entries_detected" in data
    assert "stats" in data
    assert data["stats"]["current_occupancy"] == 0


def test_api_video_process_missing_file_returns_404(api_client):
    """Verify POST /video/process with non-existent file returns 404."""
    res = api_client.post(
        "/video/process",
        json={"video_path": "missing_video_12345.mp4"},
    )
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_api_video_stop_endpoint(api_client):
    """Verify POST /video/stop responds cleanly even when idle."""
    res = api_client.post("/video/stop")
    assert res.status_code == 200
    data = res.json()
    assert "status" in data


def test_api_video_background_does_not_block_health_and_stats(api_client, tmp_path):
    """
    Verify that background video processing does not block API health or stats requests.
    """
    # Create a 20-frame synthetic video
    video_path = str(tmp_path / "bg_test.mp4")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(video_path, fourcc, 10.0, (320, 240))
    for _ in range(20):
        out.write(np.zeros((240, 320, 3), dtype=np.uint8))
    out.release()

    # Start background job
    res = api_client.post(
        "/video/process",
        json={"video_path": video_path, "max_frames": 20},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "running"

    # Immediately check health and stats while background processing is active
    health_res = api_client.get("/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "ok"

    stats_res = api_client.get("/stats")
    assert stats_res.status_code == 200
    assert "current_occupancy" in stats_res.json()

    # Wait for completion or stop
    time.sleep(1.0)
    api_client.post("/video/stop")
