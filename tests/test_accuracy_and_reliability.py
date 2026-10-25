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


def test_occupancy_invariant_formula_with_historical_clamped_exits(clean_db):
    """
    Verify that current_occupancy = max(0, total_entries - total_exits) holds even when
    exits occurred historically before entries (e.g. 2 exits when room was empty, then 27 entries and 15 exits).
    """
    c = OccupancyCounter(capacity=100, db_path=clean_db)
    
    # Simulate initial empty exits (like ID 1 and ID 2 in crowdsense.db)
    c.record_exit(count=1, note="initial_exit_1")
    c.record_exit(count=1, note="initial_exit_2")
    assert c.total_entries == 0
    assert c.total_exits == 2
    assert c.current_occupancy == 0

    # Simulate subsequent 27 entries and 15 exits
    c.record_entry(count=27, note="batch_entries")
    c.record_exit(count=15, note="batch_exits")

    assert c.total_entries == 27
    assert c.total_exits == 17
    # Crucial requirement: 27 - 17 = 10, not 12!
    assert c.current_occupancy == 10
    assert c.available_spaces == 90
    assert c.capacity_percentage == 10.0

    # Restart and restore: state must be consistently 10
    c_restored = OccupancyCounter(capacity=100, db_path=clean_db)
    assert c_restored.total_entries == 27
    assert c_restored.total_exits == 17
    assert c_restored.current_occupancy == 10
    assert c_restored.available_spaces == 90
    assert c_restored.capacity_percentage == 10.0


def test_user_exact_headcount_and_capacity_scenario(clean_db):
    """
    Verifies the user's explicit step-by-step test scenario:
    - Starting values: entries=27, exits=17 -> occupancy=10, capacity=10%, available=90.
    - After recording 1 entry: entries=28, exits=17 -> occupancy=11, capacity=11%, available=89.
    - After recording 1 exit: entries=28, exits=18 -> occupancy=10, capacity=10%, available=90.
    """
    c = OccupancyCounter(capacity=100, db_path=clean_db)
    c.record_entry(count=27, note="starting_entries")
    c.record_exit(count=17, note="starting_exits")

    # Step 1: Starting values
    stats1 = c.get_stats()
    assert stats1["total_entries"] == 27
    assert stats1["total_exits"] == 17
    assert stats1["current_occupancy"] == 10
    assert stats1["capacity_percentage"] == 10.0
    assert stats1["available_spaces"] == 90

    # Step 2: Record one entry (+1)
    c.record_entry(count=1, note="test_manual_entry")
    stats2 = c.get_stats()
    assert stats2["total_entries"] == 28
    assert stats2["total_exits"] == 17
    assert stats2["current_occupancy"] == 11
    assert stats2["capacity_percentage"] == 11.0
    assert stats2["available_spaces"] == 89

    # Step 3: Record one exit (-1)
    c.record_exit(count=1, note="test_manual_exit")
    stats3 = c.get_stats()
    assert stats3["total_entries"] == 28
    assert stats3["total_exits"] == 18
    assert stats3["current_occupancy"] == 10
    assert stats3["capacity_percentage"] == 10.0
    assert stats3["available_spaces"] == 90


# ============================================================================
# Core Regression Tests: User Section 5
# ============================================================================

def test_regression_one_person_entering_one_entry(clean_counter):
    """Regression Test 1: One person entering -> exactly one entry."""
    line = VirtualLine(pt1=(0, 200), pt2=(640, 200), margin=4.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    engine.update(track_id=1, bbox=(100, 150, 140, 190), frame_idx=1)
    evt = engine.update(track_id=1, bbox=(100, 210, 140, 250), frame_idx=2)

    assert evt == "entry"
    assert engine.total_entries == 1
    assert engine.total_exits == 0
    assert clean_counter.current_occupancy == 1


def test_regression_one_person_exiting_one_exit(clean_counter):
    """Regression Test 2: One person exiting -> exactly one exit, occupancy correctly decremented."""
    clean_counter.record_entry(count=5, note="initial_entries")
    starting_occ = clean_counter.current_occupancy
    assert starting_occ == 5

    line = VirtualLine(pt1=(0, 200), pt2=(640, 200), margin=4.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    # Person moving from below (y=230) to above (y=170) -> exit
    engine.update(track_id=2, bbox=(100, 210, 140, 250), frame_idx=1)
    evt = engine.update(track_id=2, bbox=(100, 150, 140, 190), frame_idx=2)

    assert evt == "exit"
    assert engine.total_exits == 1
    assert engine.total_entries == 0
    assert clean_counter.current_occupancy == starting_occ - 1  # 5 - 1 = 4


def test_regression_no_line_crossing_zero_events(clean_counter):
    """Regression Test 3: No line crossing -> zero events generated, headcount invariant preserved."""
    clean_counter.record_entry(count=3, note="baseline")
    baseline_occ = clean_counter.current_occupancy

    line = VirtualLine(pt1=(0, 200), pt2=(640, 200), margin=4.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    # Track 1 walks horizontally above the line (y=150)
    for f in range(10):
        evt = engine.update(track_id=10, bbox=(50 + f * 20, 130, 90 + f * 20, 170), frame_idx=f + 1)
        assert evt is None

    # Track 2 walks horizontally below the line (y=250)
    for f in range(10):
        evt = engine.update(track_id=20, bbox=(50 + f * 20, 230, 90 + f * 20, 270), frame_idx=f + 1)
        assert evt is None

    assert engine.total_entries == 0
    assert engine.total_exits == 0
    assert clean_counter.current_occupancy == baseline_occ


def test_regression_multiple_people_crossing_correct_counts(clean_counter):
    """Regression Test 4: Multiple people crossing -> correct event counts and occupancy calculation."""
    clean_counter.record_entry(count=2, note="initial_in_room")
    starting_occ = clean_counter.current_occupancy  # 2

    line = VirtualLine(pt1=(0, 200), pt2=(640, 200), margin=4.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    # Person 1 enters (150 -> 240)
    engine.update(track_id=1, bbox=(50, 130, 90, 170), frame_idx=1)
    e1 = engine.update(track_id=1, bbox=(50, 220, 90, 260), frame_idx=2)

    # Person 2 enters (160 -> 250)
    engine.update(track_id=2, bbox=(150, 140, 190, 180), frame_idx=2)
    e2 = engine.update(track_id=2, bbox=(150, 230, 190, 270), frame_idx=3)

    # Person 3 exits (250 -> 150)
    engine.update(track_id=3, bbox=(250, 230, 290, 270), frame_idx=3)
    e3 = engine.update(track_id=3, bbox=(250, 130, 290, 170), frame_idx=4)

    assert e1 == "entry"
    assert e2 == "entry"
    assert e3 == "exit"
    assert engine.total_entries == 2
    assert engine.total_exits == 1
    # current_occupancy = starting_occupancy + entries - exits = 2 + 2 - 1 = 3
    assert clean_counter.current_occupancy == starting_occ + 2 - 1


def test_regression_different_videos_independently_processed(clean_counter, tmp_path):
    """Regression Test 5: Different videos produce independent run metrics without reusing previous results."""
    # Video A: starting_occ=0, detects 2 entries
    manager = VideoJobManager(counter=clean_counter)
    dummy_video_a = str(tmp_path / "video_a.mp4")
    dummy_video_b = str(tmp_path / "video_b.mp4")
    with open(dummy_video_a, "wb") as f: f.write(b"dummy")
    with open(dummy_video_b, "wb") as f: f.write(b"dummy")

    # Simulate Video A run completion
    with manager._lock:
        manager._status = "completed"
        manager._video_path = dummy_video_a
        manager._run_id = "run_video_a"
        manager._starting_occupancy = 0
        manager._entries_detected = 2
        manager._exits_detected = 0
        manager._run_occupancy = 2
    clean_counter.record_entry(count=2, note="video_a")

    status_a = manager.get_status()
    assert status_a["video_path"] == dummy_video_a
    assert status_a["entries_detected"] == 2
    assert status_a["exits_detected"] == 0
    assert status_a["run_occupancy"] == 2

    # Now simulate Video B: must start with fresh run-specific counts
    with manager._lock:
        manager._status = "completed"
        manager._video_path = dummy_video_b
        manager._run_id = "run_video_b"
        manager._starting_occupancy = clean_counter.current_occupancy  # 2
        manager._entries_detected = 0  # fresh run
        manager._exits_detected = 1   # 1 exit in video B
        manager._run_occupancy = clean_counter.current_occupancy - 1  # 2 - 1 = 1
    clean_counter.record_exit(count=1, note="video_b")

    status_b = manager.get_status()
    assert status_b["video_path"] == dummy_video_b
    assert status_b["run_id"] == "run_video_b"
    assert status_b["entries_detected"] == 0
    assert status_b["exits_detected"] == 1
    assert status_b["starting_occupancy"] == 2
    assert status_b["run_occupancy"] == 1  # 2 + 0 - 1 = 1


def test_regression_repeated_polling_no_duplicate_events(clean_db):
    """Regression Test 6: Repeated GET polling causes no state changes, no duplicate DB entries, and is strictly idempotent."""
    counter.db_path = clean_db
    database.init_db(clean_db)
    counter.restore_state()

    client = TestClient(app)
    # Record one baseline event
    client.post("/events/entry", json={"count": 1, "note": "initial_poll_test"})

    stats_before = client.get("/stats").json()
    events_before = client.get("/events").json()

    # Poll /video/status, /stats, and /events 25 times consecutively
    for _ in range(25):
        s_res = client.get("/stats")
        v_res = client.get("/video/status")
        e_res = client.get("/events")
        assert s_res.status_code == 200
        assert v_res.status_code == 200
        assert e_res.status_code == 200

    stats_after = client.get("/stats").json()
    events_after = client.get("/events").json()

    assert stats_after["total_entries"] == stats_before["total_entries"]
    assert stats_after["total_exits"] == stats_before["total_exits"]
    assert stats_after["current_occupancy"] == stats_before["current_occupancy"]
    assert events_after["total_count"] == events_before["total_count"]


def test_regression_person_crossing_back_after_debounce(clean_counter):
    """Regression Test 5: A person genuinely crossing back after debounce window generates legitimate exit."""
    line = VirtualLine(pt1=(0, 200), pt2=(640, 200), margin=4.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", debounce_frames=10, counter=clean_counter, point_mode="center")

    # Frame 1 to 5: Enters room (y: 150 -> 250)
    engine.update(track_id=1, bbox=(100, 130, 140, 170), frame_idx=1)
    e1 = engine.update(track_id=1, bbox=(100, 230, 140, 270), frame_idx=5)
    assert e1 == "entry"
    assert clean_counter.current_occupancy == 1

    # Frame 6 to 15: Lingers inside room on side +1 (y=250)
    for f in range(6, 16):
        assert engine.update(track_id=1, bbox=(100, 230, 140, 270), frame_idx=f) is None

    # Frame 20: Crosses back out (y: 250 -> 150) after debounce has elapsed (20 - 5 = 15 >= 10)
    e2 = engine.update(track_id=1, bbox=(100, 130, 140, 170), frame_idx=20)
    assert e2 == "exit"
    assert engine.total_entries == 1
    assert engine.total_exits == 1
    assert clean_counter.current_occupancy == 0


def test_regression_two_people_crossing_close_together(clean_counter):
    """Regression Test 7: Two people walking close together across the line are counted separately."""
    line = VirtualLine(pt1=(0, 200), pt2=(640, 200), margin=4.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    # Person A (x: 100..140) and Person B (x: 130..170) walking shoulder-to-shoulder
    engine.update(track_id=10, bbox=(100, 140, 140, 180), frame_idx=1)
    engine.update(track_id=20, bbox=(130, 140, 170, 180), frame_idx=1)

    e1 = engine.update(track_id=10, bbox=(100, 220, 140, 260), frame_idx=2)
    e2 = engine.update(track_id=20, bbox=(130, 220, 170, 260), frame_idx=2)

    assert e1 == "entry"
    assert e2 == "entry"
    assert engine.total_entries == 2
    assert clean_counter.current_occupancy == 2


def test_regression_temporary_missed_detection_or_occlusion_recovery(clean_counter):
    """Regression Test 8: Trajectory stitching handles temporary occlusion and track ID change across line."""
    line = VirtualLine(pt1=(0, 200), pt2=(640, 200), margin=4.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    # Track 1 approaches line from side -1 (y=180) at frame 10
    engine.update(track_id=1, bbox=(100, 160, 140, 200), frame_idx=10)

    # Track 1 drops out at frame 11 (occluded behind doorway frame)
    engine.update_lost_tracks(active_track_ids=set(), current_frame=11)

    # Track 2 appears at frame 14 at (105, 220) on side +1 (within 25px of Track 1)
    e = engine.update(track_id=2, bbox=(105, 200, 145, 240), frame_idx=14)

    assert e == "entry"
    assert engine.total_entries == 1
    assert clean_counter.current_occupancy == 1


def test_regression_person_first_appearing_on_far_side_no_event(clean_counter):
    """Regression Test 9: Person first detected on the far side and moving further away triggers 0 events."""
    line = VirtualLine(pt1=(0, 200), pt2=(640, 200), margin=4.0)
    engine = LineCrossingCounter(line=line, entry_direction="down", counter=clean_counter, point_mode="center")

    # First detected well below line at y=300
    e1 = engine.update(track_id=5, bbox=(100, 280, 140, 320), frame_idx=1)
    assert e1 is None

    # Moves further down to y=350 and y=400 (never crossing y=200)
    e2 = engine.update(track_id=5, bbox=(100, 330, 140, 370), frame_idx=2)
    e3 = engine.update(track_id=5, bbox=(100, 380, 140, 420), frame_idx=3)

    assert e2 is None
    assert e3 is None
    assert engine.total_entries == 0
    assert engine.total_exits == 0
    assert clean_counter.current_occupancy == 0


def test_regression_different_resolutions_and_line_placements(clean_counter):
    """Regression Test 11: Supports 1080p, 720p, 480p, normalized coords, and vertical lines."""
    # 1. 1080p horizontal line at y=540
    line_1080 = VirtualLine(pt1=(0, 540), pt2=(1920, 540))
    eng_1080 = LineCrossingCounter(line=line_1080, entry_direction="down", counter=clean_counter)
    eng_1080.update(track_id=1, bbox=(500, 400, 600, 500), frame_idx=1)
    e1 = eng_1080.update(track_id=1, bbox=(500, 560, 600, 660), frame_idx=2)
    assert e1 == "entry"

    # 2. Normalized coords on VideoProcessor (1280x720)
    vp = VideoProcessor(line_coords=(0.0, 0.5, 1.0, 0.5), counter=clean_counter)
    counter_720 = vp._init_crossing_counter(1280, 720)
    assert counter_720.line.pt1 == (0, 360)
    assert counter_720.line.pt2 == (1280, 360)

    # 3. 480p vertical line at x=320 with rightward entry
    line_vert = VirtualLine(pt1=(320, 0), pt2=(320, 480))
    eng_vert = LineCrossingCounter(line=line_vert, entry_direction="right", counter=clean_counter)
    eng_vert.update(track_id=2, bbox=(260, 200, 300, 240), frame_idx=1)  # cx=280 (left of 320)
    e_vert = eng_vert.update(track_id=2, bbox=(340, 200, 380, 240), frame_idx=2)  # cx=360 (right of 320)
    assert e_vert == "entry"


def test_regression_invalid_and_unsupported_video_handling(clean_db):
    """Regression Test 12: Invalid video inputs, nonexistent files, and bad parameters return structured errors."""
    client = TestClient(app)

    # Nonexistent video path
    res = client.post("/video/process", json={"video_path": "non_existent_file_path_12345.mp4"})
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()

    # Unsupported file extension on upload
    res_ext = client.post("/video/upload", files={"file": ("test.exe", b"fake binary", "application/octet-stream")})
    assert res_ext.status_code == 400
    assert "unsupported" in res_ext.json()["detail"].lower()

    # Empty file on upload
    res_empty = client.post("/video/upload", files={"file": ("empty.mp4", b"", "video/mp4")})
    assert res_empty.status_code == 400


