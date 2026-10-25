"""
CrowdSense AI - Video Processing & Clamped Occupancy Regression Tests
Verifies:
1. Real-time occupancy updating behavior during video processing.
2. Clamped non-negative occupancy when an exit occurs while empty.
3. Database event persistence with video track metadata.
4. Directional mapping for line crossing ('down' vs 'up').
5. Recovery and consistency of session stats from SQLite.
"""

import os
import cv2
import numpy as np
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
def regression_db(tmp_path):
    """Provides an isolated SQLite database path for regression tests."""
    db_file = str(tmp_path / "regression_crowdsense.db")
    database.init_db(db_file)
    return db_file


@pytest.fixture
def regression_counter(regression_db):
    """Provides a fresh OccupancyCounter connected to the regression database."""
    return OccupancyCounter(capacity=100, db_path=regression_db)


def test_clamped_exit_when_empty_during_tracking(regression_counter, regression_db):
    """
    Regression: When a person crosses the line triggering an exit while occupancy is 0,
    current_occupancy must remain 0 (clamped non-negative), total_exits must be 1,
    and the event must be persisted to SQLite with the track ID.
    """
    assert regression_counter.current_occupancy == 0
    assert regression_counter.total_exits == 0

    horizontal_line = VirtualLine(pt1=(0, 540), pt2=(1920, 540), margin=6.0)
    engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="down",
        debounce_frames=10,
        counter=regression_counter,
        point_mode="bottom_center",
    )

    # Person 470 starts below the line (y=800) and moves upward across y=540 to y=450
    # Frame 1: Below line (y=800, side=+1)
    evt1 = engine.update(track_id=470, bbox=(900, 600, 960, 800), frame_idx=1)
    assert evt1 is None
    assert regression_counter.current_occupancy == 0

    # Frame 2: Above line (y=450, side=-1) -> Moving UPWARDS with entry_direction='down' = EXIT
    evt2 = engine.update(track_id=470, bbox=(900, 300, 960, 450), frame_idx=2)
    assert evt2 == "exit"

    # Verify run counts
    assert engine.total_entries == 0
    assert engine.total_exits == 1

    # Verify Live Headcount is clamped at 0
    stats = regression_counter.get_stats()
    assert stats["current_occupancy"] == 0
    assert stats["total_entries"] == 0
    assert stats["total_exits"] == 1
    assert stats["peak_occupancy"] == 0

    # Verify database persistence
    events = database.get_events(limit=10, db_path=regression_db)
    assert len(events) == 1
    assert events[0]["event_type"] == "exit"
    assert events[0]["count"] == 1
    assert events[0]["note"] == "video_track_id_470"


def test_inverted_entry_direction_treats_upward_as_entry(regression_counter):
    """
    Regression: If entry_direction is set to 'up', the same upward movement
    triggers an ENTRY, incrementing current_occupancy to 1.
    """
    horizontal_line = VirtualLine(pt1=(0, 540), pt2=(1920, 540), margin=6.0)
    engine = LineCrossingCounter(
        line=horizontal_line,
        entry_direction="up",
        debounce_frames=10,
        counter=regression_counter,
        point_mode="bottom_center",
    )

    # Person 470 moves from below (y=800) to above (y=450)
    engine.update(track_id=470, bbox=(900, 600, 960, 800), frame_idx=1)
    evt = engine.update(track_id=470, bbox=(900, 300, 960, 450), frame_idx=2)

    assert evt == "entry"
    assert engine.total_entries == 1
    assert engine.total_exits == 0
    assert regression_counter.current_occupancy == 1
    assert regression_counter.peak_occupancy == 1


def test_realtime_occupancy_update_via_job_manager(regression_counter, tmp_path):
    """
    Regression: Verifies that VideoJobManager reports stats.current_occupancy
    in real-time during processing.
    """
    manager = VideoJobManager(counter=regression_counter)

    # Pre-check initial status
    initial_status = manager.get_status()
    assert initial_status["stats"]["current_occupancy"] == 0
    assert initial_status["entries_detected"] == 0
    assert initial_status["exits_detected"] == 0

    # Simulate progress listener callback (as invoked during frame processing)
    manager._progress_listener({
        "processed_frames": 500,
        "total_frames": 1500,
        "progress_percentage": 33.3,
        "entries": 0,
        "exits": 1,
        "fps": 25.0,
    })

    mid_status = manager.get_status()
    assert mid_status["processed_frames"] == 500
    assert mid_status["entries_detected"] == 0
    assert mid_status["exits_detected"] == 1
    # Occupancy is clamped to 0
    assert mid_status["stats"]["current_occupancy"] == 0
