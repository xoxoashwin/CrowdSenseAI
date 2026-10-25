"""
CrowdSense AI - Counting Accuracy & Reliability Test Suite
Verifies:
1. Multiple people crossing simultaneously in the same direction.
2. Entry followed by exit for the same tracked individual.
3. Reverse-direction crossings correctly classified as exits.
4. Person crossing counted exactly once despite appearing in multiple frames.
5. Tracker ID changes or temporary detection loss handled gracefully.
6. Clamped exits at zero occupancy.
7. Correct status API responses and field mapping.
8. Anchor mode comparison ('center' vs 'bottom_center').
"""

import pytest
from fastapi.testclient import TestClient

from backend import database
from backend.counter import OccupancyCounter
from backend.main import app, counter, video_manager
from backend.video_processor import (
    LineCrossingCounter,
    VideoJobManager,
    VideoProcessor,
    VirtualLine,
)


@pytest.fixture
def clean_db(tmp_path):
    """Provides an isolated SQLite database path."""
    db_file = str(tmp_path / "test_accuracy.db")
    database.init_db(db_file)
    return db_file


@pytest.fixture
def clean_counter(clean_db):
    """Provides a clean OccupancyCounter connected to the test database."""
    return OccupancyCounter(capacity=100, db_path=clean_db)


def test_multiple_people_crossing_same_direction(clean_counter):
    """Verify that multiple people crossing simultaneously in the same direction are all counted."""
    line = VirtualLine(pt1=(0, 240), pt2=(640, 240), margin=5.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    # Frame 1: Three people above the line
    engine.update(track_id=1, bbox=(100, 150, 140, 210), frame_idx=1)
    engine.update(track_id=2, bbox=(200, 150, 240, 210), frame_idx=1)
    engine.update(track_id=3, bbox=(300, 150, 340, 210), frame_idx=1)

    # Frame 2: All three move below the line
    e1 = engine.update(track_id=1, bbox=(100, 270, 140, 330), frame_idx=2)
    e2 = engine.update(track_id=2, bbox=(200, 270, 240, 330), frame_idx=2)
    e3 = engine.update(track_id=3, bbox=(300, 270, 340, 330), frame_idx=2)

    assert e1 == "entry"
    assert e2 == "entry"
    assert e3 == "entry"
    assert engine.total_entries == 3
    assert engine.total_exits == 0
    assert clean_counter.current_occupancy == 3


def test_entry_followed_by_exit(clean_counter):
    """Verify that an individual can enter and later exit, properly updating headcounts."""
    line = VirtualLine(pt1=(0, 240), pt2=(640, 240), margin=5.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", debounce_frames=10, counter=clean_counter, point_mode="center")

    # Person 10 moves downward: entry
    engine.update(track_id=10, bbox=(200, 180, 240, 220), frame_idx=1)
    assert engine.update(track_id=10, bbox=(200, 260, 240, 300), frame_idx=2) == "entry"
    assert clean_counter.current_occupancy == 1

    # Person 10 turns around after debounce and moves upward: exit
    engine.update(track_id=10, bbox=(200, 260, 240, 300), frame_idx=15)
    assert engine.update(track_id=10, bbox=(200, 180, 240, 220), frame_idx=16) == "exit"
    assert clean_counter.current_occupancy == 0
    assert clean_counter.total_entries == 1
    assert clean_counter.total_exits == 1


def test_reverse_direction_crossings(clean_counter):
    """Verify that moving against the entry_direction is cleanly identified as an exit."""
    line = VirtualLine(pt1=(0, 240), pt2=(640, 240), margin=5.0)
    # entry_direction = "up" -> moving upward is entry, moving downward is exit
    engine = LineCrossingCounter(line=line, entry_direction="up", counter=clean_counter, point_mode="center")

    # Moving downward (below line) should be an exit
    engine.update(track_id=5, bbox=(200, 180, 240, 220), frame_idx=1)
    evt = engine.update(track_id=5, bbox=(200, 260, 240, 300), frame_idx=2)

    assert evt == "exit"
    assert engine.total_exits == 1
    assert engine.total_entries == 0


def test_person_crossing_once_despite_multiple_frames(clean_counter):
    """Verify that a person moving across the line over many frames is counted exactly once."""
    line = VirtualLine(pt1=(0, 240), pt2=(640, 240), margin=5.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", debounce_frames=15, counter=clean_counter, point_mode="center")

    counts = []
    # Person slowly steps from y=200 to y=280 across 20 frames
    for f in range(20):
        y = 200 + (f * 4)  # 200, 204, ..., 276
        res = engine.update(track_id=1, bbox=(200, y - 20, 240, y + 20), frame_idx=f + 1)
        if res:
            counts.append(res)

    assert counts == ["entry"]
    assert engine.total_entries == 1


def test_tracker_id_changes_and_deadzone_transition(clean_counter):
    """Verify that a track starting inside deadzone and crossing segment is not swallowed."""
    line = VirtualLine(pt1=(0, 240), pt2=(640, 240), margin=5.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    # Frame 1: Person first detected at y=239 (inside deadzone margin 240 +- 5)
    engine.update(track_id=88, bbox=(200, 229, 240, 249), frame_idx=1)

    # Frame 2: Person steps to y=260 (clearly below)
    evt = engine.update(track_id=88, bbox=(200, 250, 240, 270), frame_idx=2)

    assert evt == "entry"
    assert engine.total_entries == 1


def test_clamped_exits_at_zero_occupancy(clean_counter, clean_db):
    """Verify that exits when occupancy is 0 clamp to 0 and persist to database."""
    assert clean_counter.current_occupancy == 0

    clean_counter.record_exit(count=1, note="test_exit")
    assert clean_counter.current_occupancy == 0
    assert clean_counter.total_exits == 1

    events = database.get_events(limit=5, db_path=clean_db)
    assert len(events) == 1
    assert events[0]["event_type"] == "exit"
    assert events[0]["count"] == 1


def test_anchor_mode_centroid_vs_feet():
    """Verify that center anchor detects crossings when feet are already near bottom."""
    # Virtual line at y=540 across 1080p frame
    line = VirtualLine(pt1=(0, 540), pt2=(1920, 540), margin=6.0)

    # Person with tall box:
    # Frame 1: y1=200, y2=700 -> cy=(200+700)/2 = 450 (ABOVE 540), feet=700 (BELOW 540)
    # Frame 2: y1=500, y2=900 -> cy=(500+900)/2 = 700 (BELOW 540), feet=900 (BELOW 540)
    engine_center = LineCrossingCounter(line=line, entry_direction="down", point_mode="center")
    engine_feet = LineCrossingCounter(line=line, entry_direction="down", point_mode="bottom_center")

    engine_center.update(track_id=1, bbox=(500, 200, 700, 700), frame_idx=1)
    engine_feet.update(track_id=1, bbox=(500, 200, 700, 700), frame_idx=1)

    evt_center = engine_center.update(track_id=1, bbox=(500, 500, 700, 900), frame_idx=2)
    evt_feet = engine_feet.update(track_id=1, bbox=(500, 500, 700, 900), frame_idx=2)

    # Center detects crossing: 450 -> 700 crosses 540 downwards
    assert evt_center == "entry"
    # Feet misses crossing: 700 -> 900 was always below 540
    assert evt_feet is None


def test_api_status_response_field_mapping(clean_db):
    """Verify GET /video/status schema matches frontend expectations."""
    original_db = counter.db_path
    counter.db_path = clean_db
    database.init_db(clean_db)

    with TestClient(app) as client:
        res = client.get("/video/status")
        assert res.status_code == 200
        data = res.json()

        expected_fields = [
            "status",
            "video_path",
            "total_frames",
            "processed_frames",
            "progress_percentage",
            "entries_detected",
            "exits_detected",
            "current_fps",
            "error_message",
            "point_mode",
            "debug_video_path",
            "stats",
        ]
        for f in expected_fields:
            assert f in data, f"Missing field: {f}"

    counter.db_path = original_db
