"""
CrowdSense AI - Database Layer
Handles SQLite persistence for entry and exit events.
"""

from datetime import datetime, timezone
import os
import sqlite3
from typing import Any, Dict, List, Optional

# Default database file location in the project root
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "crowdsense.db")


def get_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """
    Creates and returns a connection to the SQLite database.
    Row factory is set to sqlite3.Row for dictionary-like column access.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: str = DEFAULT_DB_PATH) -> None:
    """
    Initializes the database schema if tables do not already exist.
    """
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL CHECK(event_type IN ('entry', 'exit')),
                count INTEGER NOT NULL DEFAULT 1,
                timestamp TEXT NOT NULL,
                note TEXT
            );
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                last_event_id INTEGER NOT NULL DEFAULT 0,
                timestamp TEXT NOT NULL,
                note TEXT
            );
            """
        )
        conn.commit()


def log_event(
    event_type: str,
    count: int = 1,
    note: Optional[str] = None,
    timestamp: Optional[str] = None,
    db_path: str = DEFAULT_DB_PATH,
) -> int:
    """
    Logs an entry or exit event to SQLite.
    Returns the ID of the inserted event record.
    """
    if event_type not in ("entry", "exit"):
        raise ValueError(f"Invalid event_type: {event_type}. Must be 'entry' or 'exit'.")

    if count < 1:
        raise ValueError("Count must be at least 1.")

    if timestamp is None:
        timestamp = datetime.now(timezone.utc).isoformat()

    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO events (event_type, count, timestamp, note)
            VALUES (?, ?, ?, ?);
            """,
            (event_type, count, timestamp, note),
        )
        conn.commit()
        return cursor.lastrowid or 0


def get_events(limit: int = 50, db_path: str = DEFAULT_DB_PATH) -> List[Dict[str, Any]]:
    """
    Retrieves the most recent events ordered by newest first.
    """
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, event_type, count, timestamp, note
            FROM events
            ORDER BY id DESC
            LIMIT ?;
            """,
            (limit,),
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_event_totals(db_path: str = DEFAULT_DB_PATH) -> Dict[str, int]:
    """
    Aggregates total entries and exits from the database events table.
    """
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN event_type = 'entry' THEN count ELSE 0 END), 0) AS total_entries,
                COALESCE(SUM(CASE WHEN event_type = 'exit' THEN count ELSE 0 END), 0) AS total_exits
            FROM events;
            """
        )
        row = cursor.fetchone()
        if row:
            return {
                "total_entries": int(row["total_entries"]),
                "total_exits": int(row["total_exits"]),
            }
        return {"total_entries": 0, "total_exits": 0}


def record_reset(
    last_event_id: Optional[int] = None,
    note: Optional[str] = None,
    timestamp: Optional[str] = None,
    db_path: str = DEFAULT_DB_PATH,
) -> int:
    """
    Records a reset boundary in SQLite.
    If last_event_id is None, automatically uses the maximum event ID currently in the events table.
    """
    init_db(db_path)
    if timestamp is None:
        timestamp = datetime.now(timezone.utc).isoformat()

    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        if last_event_id is None:
            cursor.execute("SELECT COALESCE(MAX(id), 0) AS max_id FROM events;")
            row = cursor.fetchone()
            last_event_id = int(row["max_id"]) if row else 0

        cursor.execute(
            """
            INSERT INTO resets (last_event_id, timestamp, note)
            VALUES (?, ?, ?);
            """,
            (last_event_id, timestamp, note),
        )
        conn.commit()
        return cursor.lastrowid or 0


def get_last_reset_event_id(db_path: str = DEFAULT_DB_PATH) -> int:
    """
    Returns the last event ID up to which a reset was applied.
    Returns 0 if no resets have been recorded.
    """
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT last_event_id FROM resets
            ORDER BY id DESC LIMIT 1;
            """
        )
        row = cursor.fetchone()
        return int(row["last_event_id"]) if row else 0


def get_events_since(last_event_id: int = 0, db_path: str = DEFAULT_DB_PATH) -> List[Dict[str, Any]]:
    """
    Retrieves all events logged after the specified event ID, ordered chronologically (oldest first).
    Used to reconstruct active in-memory occupancy and session statistics.
    """
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, event_type, count, timestamp, note
            FROM events
            WHERE id > ?
            ORDER BY id ASC;
            """,
            (last_event_id,),
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def clear_events(db_path: str = DEFAULT_DB_PATH) -> None:
    """
    Clears all records from the events and resets tables (used for resets and testing).
    """
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM events;")
        cursor.execute("DELETE FROM resets;")
        conn.commit()

