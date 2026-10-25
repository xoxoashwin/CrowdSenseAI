"""
CrowdSense AI - Error Boundary & Hardening Test Suite
Verifies that unhandled exceptions, malformed payloads, invalid query parameters,
and client disconnections are gracefully caught and returned as structured JSON.
"""

from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from backend import database
from backend.main import app, counter


@pytest.fixture
def temp_db(tmp_path):
    """Provides an isolated SQLite database path for error boundary testing."""
    db_file = str(tmp_path / "test_error_boundary.db")
    database.init_db(db_file)
    return db_file


@pytest.fixture
def client(temp_db):
    """Provides a TestClient connected to an isolated test database."""
    original_db = counter.db_path
    counter.db_path = temp_db
    database.init_db(temp_db)
    counter.reset(clear_db=True)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    counter.reset(clear_db=True)
    counter.db_path = original_db
    counter.restore_state()


def test_validation_error_returns_structured_json(client):
    """
    Verify that invalid request bodies trigger RequestValidationError
    and return structured JSON with 422 status code.
    """
    res = client.post("/events/entry", json={"count": "invalid_integer_string"})
    assert res.status_code == 422
    data = res.json()
    assert data["error"] == "ValidationError"
    assert "validation" in data["message"].lower()
    assert isinstance(data["detail"], list)
    assert data["status_code"] == 422


def test_query_parameter_validation_error(client):
    """
    Verify that out-of-range query parameters (limit < 1)
    return structured 422 JSON instead of crashing.
    """
    res = client.get("/events?limit=-10")
    assert res.status_code == 422
    data = res.json()
    assert data["error"] == "ValidationError"
    assert data["status_code"] == 422


def test_not_found_returns_structured_json(client):
    """
    Verify that requesting non-existent endpoints returns structured 404 JSON.
    """
    res = client.get("/nonexistent_endpoint_xyz")
    assert res.status_code == 404
    data = res.json()
    assert data["error"] == "HttpException"
    assert data["status_code"] == 404
    assert "not found" in str(data["detail"]).lower()


def test_unhandled_exception_returns_structured_500(client):
    """
    Verify that unexpected server exceptions are caught by the global error boundary,
    returning structured 500 JSON without crashing the server process.
    """
    with patch.object(counter, "record_entry", side_effect=RuntimeError("Simulated critical DB failure")):
        res = client.post("/events/entry", json={"count": 1})
        assert res.status_code == 500
        data = res.json()
        assert data["error"] == "InternalServerError"
        assert "unexpected error" in data["message"].lower()
        assert "Simulated critical DB failure" in data["detail"]
        assert data["status_code"] == 500


def test_unhandled_exception_in_stats_endpoint(client):
    """
    Verify that unexpected errors in read-only endpoints like /stats return structured 500.
    """
    with patch.object(counter, "get_stats", side_effect=ValueError("Simulated state calculation failure")):
        res = client.get("/stats")
        assert res.status_code == 500
        data = res.json()
        assert data["error"] == "InternalServerError"
        assert "Simulated state calculation failure" in data["detail"]


def test_database_state_persists_safely_after_handled_error(client):
    """
    Verify that counter and database integrity remain completely intact
    after error boundary catches and handles an exception.
    """
    # 1. Normal successful entry
    res1 = client.post("/events/entry", json={"count": 2})
    assert res1.status_code == 200
    assert res1.json()["stats"]["current_occupancy"] == 2

    # 2. Trigger a simulated failure
    with patch.object(counter, "record_entry", side_effect=RuntimeError("Transient failure")):
        res_fail = client.post("/events/entry", json={"count": 1})
        assert res_fail.status_code == 500

    # 3. Subsequent calls work normally and state was preserved
    res2 = client.get("/stats")
    assert res2.status_code == 200
    assert res2.json()["current_occupancy"] == 2
