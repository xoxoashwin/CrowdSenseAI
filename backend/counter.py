"""
CrowdSense AI - Occupancy Counter
Maintains occupancy counts, calculates statistics, and prevents negative occupancy.
"""

from typing import Any, Dict, Optional
from backend import database


class OccupancyCounter:
    """
    Tracks real-time occupancy, entries, exits, and peak occupancy for a venue.
    Guarantees the invariant:
        current_occupancy = max(0, total_entries - total_exits)
    """

    def __init__(
        self,
        capacity: int = 100,
        db_path: str = database.DEFAULT_DB_PATH,
        auto_restore: bool = True,
    ):
        if capacity <= 0:
            raise ValueError("Capacity must be greater than zero.")
        self.capacity: int = capacity
        self.db_path: str = db_path
        self._current_occupancy: int = 0
        self.total_entries: int = 0
        self.total_exits: int = 0
        self.peak_occupancy: int = 0

        # Ensure database is initialized
        database.init_db(self.db_path)

        if auto_restore:
            self.restore_state()

    @property
    def current_occupancy(self) -> int:
        """
        Current headcount is calculated consistently:
        current_occupancy = max(0, total_entries - total_exits)
        """
        return max(0, self.total_entries - self.total_exits)

    @current_occupancy.setter
    def current_occupancy(self, value: int) -> None:
        self._current_occupancy = value

    @property
    def available_spaces(self) -> int:
        """
        Remaining available spaces: max(0, capacity - current_occupancy).
        """
        return max(0, self.capacity - self.current_occupancy)

    @property
    def capacity_percentage(self) -> float:
        """
        Calculates occupancy percentage relative to capacity, rounded to 1 decimal place.
        """
        if self.capacity <= 0:
            return 0.0
        pct = (self.current_occupancy / self.capacity) * 100.0
        return round(pct, 1)

    def record_entry(self, count: int = 1, note: Optional[str] = None, persist: bool = True) -> int:
        """
        Increments the occupancy and total entries.
        Updates peak occupancy if the new occupancy exceeds the current peak.
        Optionally persists the event to SQLite.

        Returns:
            int: The ID of the logged database event (or 0 if not persisted).
        """
        if count <= 0:
            raise ValueError("Entry count must be positive.")

        self.total_entries += count

        if self.current_occupancy > self.peak_occupancy:
            self.peak_occupancy = self.current_occupancy

        event_id = 0
        if persist:
            event_id = database.log_event(
                event_type="entry",
                count=count,
                note=note,
                db_path=self.db_path,
            )

        return event_id

    def record_exit(self, count: int = 1, note: Optional[str] = None, persist: bool = True) -> int:
        """
        Decrements occupancy and increments total exits.
        Guarantees that current_occupancy is never negative.
        Optionally persists the event to SQLite.

        Returns:
            int: The ID of the logged database event (or 0 if not persisted).
        """
        if count <= 0:
            raise ValueError("Exit count must be positive.")

        self.total_exits += count

        event_id = 0
        if persist:
            event_id = database.log_event(
                event_type="exit",
                count=count,
                note=note,
                db_path=self.db_path,
            )

        return event_id

    def get_status(self) -> str:
        """
        Returns a human-readable status indicating the crowd density.
        """
        pct = self.capacity_percentage
        if pct < 60.0:
            return "Normal"
        elif pct < 85.0:
            return "Moderate"
        elif pct < 100.0:
            return "Near Capacity"
        elif pct == 100.0:
            return "At Capacity"
        else:
            return "Over Capacity"

    def get_stats(self) -> Dict[str, Any]:
        """
        Returns a dictionary matching the StatsResponse schema.
        """
        return {
            "total_entries": self.total_entries,
            "total_exits": self.total_exits,
            "current_occupancy": self.current_occupancy,
            "peak_occupancy": self.peak_occupancy,
            "capacity": self.capacity,
            "capacity_percentage": self.capacity_percentage,
            "status": self.get_status(),
            "available_spaces": self.available_spaces,
        }

    def restore_state(self) -> Dict[str, Any]:
        """
        Reconstructs occupancy and session totals from SQLite events recorded
        since the most recent reset boundary.
        Replays events in chronological order, calculating occupancy strictly
        via the invariant: current_occupancy = max(0, total_entries - total_exits),
        while accurately computing the peak occupancy achieved.
        """
        last_event_id = database.get_last_reset_event_id(self.db_path)
        events = database.get_events_since(last_event_id=last_event_id, db_path=self.db_path)

        self.total_entries = 0
        self.total_exits = 0
        self.peak_occupancy = 0

        for event in events:
            etype = event["event_type"]
            count = int(event["count"])
            if etype == "entry":
                self.total_entries += count
            elif etype == "exit":
                self.total_exits += count

            occ = max(0, self.total_entries - self.total_exits)
            if occ > self.peak_occupancy:
                self.peak_occupancy = occ

        return self.get_stats()

    def reset(self, clear_db: bool = False) -> None:
        """
        Resets in-memory counters to zero.
        If clear_db is True, deletes all logged events and resets from SQLite.
        If clear_db is False, records a reset boundary in SQLite so historical events
        are preserved for audit logs without being replayed as active occupancy on restart.
        """
        self.total_entries = 0
        self.total_exits = 0
        self.peak_occupancy = 0
        self._current_occupancy = 0

        if clear_db:
            database.clear_events(self.db_path)
        else:
            database.record_reset(db_path=self.db_path, note="session_reset")
