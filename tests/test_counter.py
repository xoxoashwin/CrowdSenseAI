"""
CrowdSense AI - Backend Test Suite
Tests occupancy counting logic, peak occupancy tracking,
negative occupancy prevention, SQLite persistence, and FastAPI endpoints.
"""

import os
import pytest
from fastapi.testclient import TestClient

from backend import database
from backend.counter import OccupancyCounter
from backend.main import app, counter


@pytest.fixture
def temp_db(tmp_path):
    """Provides an isolated SQLite database path for unit testing."""
    db_file = str(tmp_path / "test_crowdsense.db")
    database.init_db(db_file)
    return db_file


@pytest.fixture
def test_counter(temp_db):
    """Provides a fresh OccupancyCounter instance connected to the test database."""
    return OccupancyCounter(capacity=100, db_path=temp_db)


@pytest.fixture
def client(temp_db):
    """Provides a TestClient with a fresh counter instance for API testing."""
    original_db = counter.db_path
    counter.db_path = temp_db
    database.init_db(temp_db)
    counter.reset(clear_db=True)
    with TestClient(app) as test_client:
        yield test_client
    counter.reset(clear_db=True)
    counter.db_path = original_db
    counter.restore_state()



# ============================================================================
# Unit Tests: OccupancyCounter Logic
# ============================================================================

def test_initial_counter_state(test_counter):
    """Verify default initial values for a new counter instance."""
    stats = test_counter.get_stats()
    assert stats["current_occupancy"] == 0
    assert stats["total_entries"] == 0
    assert stats["total_exits"] == 0
    assert stats["peak_occupancy"] == 0
    assert stats["capacity"] == 100
    assert stats["capacity_percentage"] == 0.0
    assert stats["status"] == "Normal"


def test_entry_updates_occupancy_and_totals(test_counter):
    """Verify that recording entries increments current occupancy and total entries."""
    test_counter.record_entry(count=1)
    stats = test_counter.get_stats()
    assert stats["current_occupancy"] == 1
    assert stats["total_entries"] == 1
    assert stats["peak_occupancy"] == 1

    # Record multiple entries at once
    test_counter.record_entry(count=4)
    stats = test_counter.get_stats()
    assert stats["current_occupancy"] == 5
    assert stats["total_entries"] == 5
    assert stats["peak_occupancy"] == 5


def test_exit_updates_occupancy_and_totals(test_counter):
    """Verify that recording exits decrements current occupancy and increments total exits."""
    test_counter.record_entry(count=5)
    test_counter.record_exit(count=2)

    stats = test_counter.get_stats()
    assert stats["current_occupancy"] == 3
    assert stats["total_entries"] == 5
    assert stats["total_exits"] == 2
    assert stats["peak_occupancy"] == 5


def test_peak_occupancy_tracking(test_counter):
    """Verify that peak occupancy preserves the session's maximum count."""
    test_counter.record_entry(count=10)
    assert test_counter.peak_occupancy == 10

    # Occupancy decreases, peak remains unchanged
    test_counter.record_exit(count=6)
    assert test_counter.current_occupancy == 4
    assert test_counter.peak_occupancy == 10

    # Occupancy increases again but below peak
    test_counter.record_entry(count=3)
    assert test_counter.current_occupancy == 7
    assert test_counter.peak_occupancy == 10

    # Occupancy exceeds previous peak
    test_counter.record_entry(count=5)
    assert test_counter.current_occupancy == 12
    assert test_counter.peak_occupancy == 12


def test_prevent_negative_occupancy_when_empty(test_counter):
    """Verify occupancy never drops below zero when exits occur in an empty room."""
    assert test_counter.current_occupancy == 0

    test_counter.record_exit(count=1)
    stats = test_counter.get_stats()
    assert stats["current_occupancy"] == 0
    assert stats["total_exits"] == 1

    # Multiple consecutive exits while empty
    test_counter.record_exit(count=5)
    stats = test_counter.get_stats()
    assert stats["current_occupancy"] == 0
    assert stats["total_exits"] == 6


def test_prevent_negative_occupancy_when_exits_exceed_occupancy(test_counter):
    """Verify occupancy clamps to zero when exit count exceeds current occupancy."""
    test_counter.record_entry(count=3)
    assert test_counter.current_occupancy == 3

    # 10 people exit when only 3 are inside
    test_counter.record_exit(count=10)
    stats = test_counter.get_stats()
    assert stats["current_occupancy"] == 0
    assert stats["total_entries"] == 3
    assert stats["total_exits"] == 10


def test_capacity_percentage_and_status_levels(temp_db):
    """Verify capacity percentage math and human-readable status levels."""
    c = OccupancyCounter(capacity=100, db_path=temp_db)

    # 0%: Normal
    assert c.capacity_percentage == 0.0
    assert c.get_status() == "Normal"

    # 50%: Normal (< 60%)
    c.record_entry(count=50)
    assert c.capacity_percentage == 50.0
    assert c.get_status() == "Normal"

    # 70%: Moderate (60% - 84.9%)
    c.record_entry(count=20)
    assert c.capacity_percentage == 70.0
    assert c.get_status() == "Moderate"

    # 90%: Near Capacity (85% - 99.9%)
    c.record_entry(count=20)
    assert c.capacity_percentage == 90.0
    assert c.get_status() == "Near Capacity"

    # 100%: At Capacity
    c.record_entry(count=10)
    assert c.capacity_percentage == 100.0
    assert c.get_status() == "At Capacity"

    # 110%: Over Capacity
    c.record_entry(count=10)
    assert c.capacity_percentage == 110.0
    assert c.get_status() == "Over Capacity"


def test_database_event_persistence(test_counter, temp_db):
    """Verify that entry and exit events are properly persisted to SQLite."""
    entry_id = test_counter.record_entry(count=2, note="front_door")
    exit_id = test_counter.record_exit(count=1, note="back_door")

    assert entry_id > 0
    assert exit_id > entry_id

    events = database.get_events(limit=10, db_path=temp_db)
    assert len(events) == 2
    # Newest event is first
    assert events[0]["event_type"] == "exit"
    assert events[0]["count"] == 1
    assert events[0]["note"] == "back_door"
    assert events[1]["event_type"] == "entry"
    assert events[1]["count"] == 2
    assert events[1]["note"] == "front_door"

    totals = database.get_event_totals(db_path=temp_db)
    assert totals["total_entries"] == 2
    assert totals["total_exits"] == 1


# ============================================================================
# API Endpoint Integration Tests
# ============================================================================

def test_health_endpoint(client):
    """Verify GET /health confirms API status."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "CrowdSense AI"
    assert "version" in data


def test_stats_endpoint(client):
    """Verify GET /stats returns all required fields."""
    response = client.get("/stats")
    assert response.status_code == 200
    data = response.json()

    # Verify all 7 required fields from Requirements
    required_fields = [
        "total_entries",
        "total_exits",
        "current_occupancy",
        "peak_occupancy",
        "capacity",
        "capacity_percentage",
        "status",
    ]
    for field in required_fields:
        assert field in data, f"Missing field: {field}"

    assert data["total_entries"] == 0
    assert data["total_exits"] == 0
    assert data["current_occupancy"] == 0
    assert data["peak_occupancy"] == 0
    assert data["capacity"] == 100
    assert data["capacity_percentage"] == 0.0
    assert data["status"] == "Normal"


def test_api_entry_and_exit_flow(client):
    """Verify recording entries and exits through the API updates stats correctly."""
    # Record 3 entries
    entry_res = client.post("/events/entry", json={"count": 3, "note": "camera_1"})
    assert entry_res.status_code == 200
    stats = entry_res.json()["stats"]
    assert stats["current_occupancy"] == 3
    assert stats["total_entries"] == 3
    assert stats["peak_occupancy"] == 3

    # Record 1 exit
    exit_res = client.post("/events/exit", json={"count": 1, "note": "camera_1"})
    assert exit_res.status_code == 200
    stats = exit_res.json()["stats"]
    assert stats["current_occupancy"] == 2
    assert stats["total_entries"] == 3
    assert stats["total_exits"] == 1
    assert stats["peak_occupancy"] == 3

    # Confirm stats endpoint matches
    stats_res = client.get("/stats")
    assert stats_res.status_code == 200
    data = stats_res.json()
    assert data["current_occupancy"] == 2
    assert data["total_entries"] == 3
    assert data["total_exits"] == 1
    assert data["peak_occupancy"] == 3


def test_api_prevent_negative_occupancy(client):
    """Verify that calling exit API repeatedly does not cause negative occupancy."""
    # Initially 0 occupancy
    exit_res1 = client.post("/events/exit", json={"count": 5})
    assert exit_res1.status_code == 200
    assert exit_res1.json()["stats"]["current_occupancy"] == 0

    # Enter 2, then exit 5
    client.post("/events/entry", json={"count": 2})
    exit_res2 = client.post("/events/exit", json={"count": 5})
    assert exit_res2.status_code == 200
    stats = exit_res2.json()["stats"]
    assert stats["current_occupancy"] == 0
    assert stats["total_entries"] == 2
    assert stats["total_exits"] == 10  # 5 + 5


def test_api_events_list_and_reset(client):
    """Verify /events lists recorded events and /reset resets the counter."""
    client.post("/events/entry", json={"count": 4, "note": "batch_entry"})
    events_res = client.get("/events?limit=10")
    assert events_res.status_code == 200
    events_data = events_res.json()
    assert events_data["total_count"] >= 1
    assert events_data["events"][0]["event_type"] == "entry"

    # Reset counters
    reset_res = client.post("/reset?clear_history=true")
    assert reset_res.status_code == 200
    stats = reset_res.json()["stats"]
    assert stats["current_occupancy"] == 0
    assert stats["total_entries"] == 0
    assert stats["peak_occupancy"] == 0


# ============================================================================
# Unit Tests: Restart Recovery & Reset Boundary Handling
# ============================================================================

def test_restart_recovery_without_reset(temp_db):
    """
    Verify that an OccupancyCounter instance created after a restart restores
    its current occupancy, peak occupancy, total entries, and total exits from SQLite.
    """
    # Active session 1
    c1 = OccupancyCounter(capacity=100, db_path=temp_db)
    c1.record_entry(count=6, note="door_1")
    c1.record_exit(count=2, note="door_1")
    c1.record_entry(count=3, note="door_1")
    # State: occupancy=7, peak=7, entries=9, exits=2
    assert c1.current_occupancy == 7
    assert c1.peak_occupancy == 7
    assert c1.total_entries == 9
    assert c1.total_exits == 2

    # Simulate server shutdown & restart: new OccupancyCounter instance connected to same DB
    c2 = OccupancyCounter(capacity=100, db_path=temp_db)
    assert c2.current_occupancy == 7
    assert c2.peak_occupancy == 7
    assert c2.total_entries == 9
    assert c2.total_exits == 2
    assert c2.get_status() == "Normal"


def test_restart_recovery_with_clear_history_false(temp_db):
    """
    Verify that reset(clear_db=False) preserves all SQLite event records,
    resets session statistics to zero, and prevents restart from falsely
    counting historical events as active occupancy.
    """
    c1 = OccupancyCounter(capacity=100, db_path=temp_db)
    c1.record_entry(count=10, note="morning_session")
    c1.record_exit(count=4, note="morning_session")
    assert c1.current_occupancy == 6

    # Reset counters at the end of the morning session without clearing historical log
    c1.reset(clear_db=False)
    assert c1.current_occupancy == 0
    assert c1.total_entries == 0
    assert c1.total_exits == 0
    assert c1.peak_occupancy == 0

    # Historical events must still exist in SQLite
    events = database.get_events(limit=50, db_path=temp_db)
    assert len(events) == 2

    # Simulate restart: newly initialized counter must respect reset boundary
    c2 = OccupancyCounter(capacity=100, db_path=temp_db)
    assert c2.current_occupancy == 0
    assert c2.total_entries == 0
    assert c2.total_exits == 0
    assert c2.peak_occupancy == 0


def test_post_reset_event_tracking_and_restart(temp_db):
    """
    Verify that events logged after reset(clear_db=False) are tracked for the new session
    and accurately restored on restart without conflating pre-reset events.
    """
    c1 = OccupancyCounter(capacity=100, db_path=temp_db)
    c1.record_entry(count=5)
    c1.reset(clear_db=False)

    # Afternoon session begins: 3 entries, 1 exit
    c1.record_entry(count=3, note="afternoon_session")
    c1.record_exit(count=1, note="afternoon_session")
    assert c1.current_occupancy == 2
    assert c1.total_entries == 3
    assert c1.total_exits == 1
    assert c1.peak_occupancy == 3

    # All 3 events (1 pre-reset + 2 post-reset) exist in SQLite
    all_events = database.get_events(limit=50, db_path=temp_db)
    assert len(all_events) == 3

    # Simulate restart: only post-reset events are replayed for active occupancy
    c2 = OccupancyCounter(capacity=100, db_path=temp_db)
    assert c2.current_occupancy == 2
    assert c2.total_entries == 3
    assert c2.total_exits == 1
    assert c2.peak_occupancy == 3


def test_restart_recovery_with_clear_history_true(temp_db):
    """
    Verify that reset(clear_db=True) wipes SQLite completely and restart begins at 0.
    """
    c1 = OccupancyCounter(capacity=100, db_path=temp_db)
    c1.record_entry(count=5)
    c1.reset(clear_db=True)

    # Database is completely empty
    assert len(database.get_events(limit=50, db_path=temp_db)) == 0

    # Restart has 0 state
    c2 = OccupancyCounter(capacity=100, db_path=temp_db)
    assert c2.current_occupancy == 0
    assert c2.total_entries == 0
    assert c2.total_exits == 0
    assert c2.peak_occupancy == 0


def test_occupancy_reconstruction_with_video_generated_events(temp_db):
    """
    Verify that events recorded by video processing with tracking ID notes
    (e.g., video_track_id_93) accurately restore occupancy and peak occupancy.
    """
    c1 = OccupancyCounter(capacity=100, db_path=temp_db)
    # Simulate video footfall events
    video_events = [
        ("exit", 1, "video_track_id_6"),
        ("entry", 1, "video_track_id_3"),
        ("exit", 1, "video_track_id_46"),
        ("entry", 1, "video_track_id_15"),
        ("entry", 1, "video_track_id_34"),
        ("entry", 1, "video_track_id_19"),
        ("exit", 1, "video_track_id_4"),
        ("entry", 1, "video_track_id_93"),
    ]
    for etype, cnt, note in video_events:
        if etype == "entry":
            c1.record_entry(count=cnt, note=note)
        else:
            c1.record_exit(count=cnt, note=note)

    stats1 = c1.get_stats()

    # Simulate server restart
    c2 = OccupancyCounter(capacity=100, db_path=temp_db)
    stats2 = c2.get_stats()

    assert stats2["total_entries"] == stats1["total_entries"] == 5
    assert stats2["total_exits"] == stats1["total_exits"] == 3
    assert stats2["current_occupancy"] == stats1["current_occupancy"] == 2
    assert stats2["peak_occupancy"] == stats1["peak_occupancy"] == 2



def test_api_reset_clear_history_false_preserves_events_and_stats(client):
    """
    Verify through the REST API that /reset?clear_history=false:
    1. Resets /stats to 0
    2. Keeps all events visible via GET /events
    3. Reconstructed stats after a simulated reload remain at 0
    """
    client.post("/events/entry", json={"count": 5, "note": "cam_entry"})
    client.post("/events/exit", json={"count": 2, "note": "cam_exit"})

    # Check stats before reset
    stats_before = client.get("/stats").json()
    assert stats_before["current_occupancy"] == 3

    # Reset with clear_history=false
    reset_res = client.post("/reset?clear_history=false")
    assert reset_res.status_code == 200
    assert reset_res.json()["stats"]["current_occupancy"] == 0

    # /stats endpoint reports 0
    stats_after = client.get("/stats").json()
    assert stats_after["current_occupancy"] == 0
    assert stats_after["total_entries"] == 0
    assert stats_after["total_exits"] == 0

    # /events endpoint still returns the 2 historical events
    events_res = client.get("/events?limit=10").json()
    assert events_res["total_count"] == 2

