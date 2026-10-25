"""
CrowdSense AI - Video Processing & Footfall Counting Engine
Integrates Ultralytics YOLO person detection, ByteTrack tracking,
virtual-line crossing detection, duplicate prevention, and background processing.
"""

from collections import deque
from dataclasses import dataclass, field
import logging
import math
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
import uuid

import cv2
import numpy as np

from backend.counter import OccupancyCounter

logger = logging.getLogger("crowdsense.video")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


@dataclass
class VirtualLine:
    """
    Represents a virtual crossing line segment between pt1 and pt2.
    Includes a deadzone margin (in pixels) to prevent boundary oscillation noise.
    """
    pt1: Tuple[int, int]
    pt2: Tuple[int, int]
    margin: float = 4.0

    @property
    def length(self) -> float:
        dx = self.pt2[0] - self.pt1[0]
        dy = self.pt2[1] - self.pt1[1]
        return math.hypot(dx, dy)

    def signed_distance(self, point: Tuple[float, float]) -> float:
        """
        Computes the perpendicular signed distance from point to the directed line pt1 -> pt2.
        Positive distance: point is on the 'right' / positive side of the line vector.
        Negative distance: point is on the 'left' / negative side of the line vector.
        """
        x1, y1 = self.pt1
        x2, y2 = self.pt2
        px, py = point

        line_len = self.length
        if line_len < 1e-6:
            return 0.0

        # Cross product: (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
        cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
        return cross / line_len

    def side_of_line(self, point: Tuple[float, float]) -> int:
        """
        Determines which side of the line the point is on:
        +1: Clearly on the positive side (distance > margin)
        -1: Clearly on the negative side (distance < -margin)
         0: Inside the deadzone / hysteresis margin
        """
        dist = self.signed_distance(point)
        if dist > self.margin:
            return 1
        elif dist < -self.margin:
            return -1
        return 0

    def intersects_segment(self, p1: Tuple[float, float], p2: Tuple[float, float]) -> bool:
        """
        Determines whether movement segment p1 -> p2 intersects the line pt1 -> pt2.
        Uses orientation determinants (cross products) to check for segment intersection.
        """
        def ccw(A, B, C):
            return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])

        d1 = ccw(self.pt1, self.pt2, p1)
        d2 = ccw(self.pt1, self.pt2, p2)
        d3 = ccw(p1, p2, self.pt1)
        d4 = ccw(p1, p2, self.pt2)

        if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
           ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
            return True

        # Endpoints touching or passing through line within margin
        dist1 = self.signed_distance(p1)
        dist2 = self.signed_distance(p2)
        if (dist1 > 0 and dist2 < 0) or (dist1 < 0 and dist2 > 0):
            min_x = min(self.pt1[0], self.pt2[0]) - self.margin
            max_x = max(self.pt1[0], self.pt2[0]) + self.margin
            min_y = min(self.pt1[1], self.pt2[1]) - self.margin
            max_y = max(self.pt1[1], self.pt2[1]) + self.margin
            if (min_x <= p1[0] <= max_x or min_x <= p2[0] <= max_x) and \
               (min_y <= p1[1] <= max_y or min_y <= p2[1] <= max_y):
                return True

        return False


@dataclass
class TrackState:
    """Maintains trajectory and crossing state for an individual tracking ID."""
    track_id: int
    last_known_side: int = 0
    last_position: Optional[Tuple[float, float]] = None
    last_count_frame: int = -9999
    last_event_type: Optional[str] = None
    history: deque = field(default_factory=lambda: deque(maxlen=40))
    counted_crossings: int = 0
    first_seen_frame: int = 0
    last_seen_frame: int = 0
    stitched_from: Optional[int] = None


class LineCrossingCounter:
    """
    Detects directional line crossings from tracked object trajectories.
    Prevents duplicate counts through debounce windows, hysteresis deadzones,
    and state-transition locks.
    Supports trajectory stitching across brief ByteTrack dropouts.
    """

    def __init__(
        self,
        line: VirtualLine,
        entry_direction: str = "down",
        debounce_frames: int = 15,
        counter: Optional[OccupancyCounter] = None,
        point_mode: str = "center",
        run_id: Optional[str] = None,
    ):
        self.line = line
        self.entry_direction = entry_direction.lower()
        self.debounce_frames = debounce_frames
        self.counter = counter
        self.point_mode = point_mode
        self.run_id = run_id or f"run_{uuid.uuid4().hex[:6]}"

        self.tracks: Dict[int, TrackState] = {}
        self.total_entries: int = 0
        self.total_exits: int = 0
        self.crossing_events: List[Dict[str, Any]] = []

        # Buffer of recently lost tracks for track-ID continuity / recovery
        self.recent_lost_tracks: deque = deque(maxlen=30)

    def _get_anchor_point(self, bbox: Tuple[float, float, float, float]) -> Tuple[float, float]:
        """Calculates either centroid or bottom-center (feet position) from bbox."""
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2.0
        if self.point_mode == "bottom_center":
            cy = float(y2)
        else:
            cy = (y1 + y2) / 2.0
        return (cx, cy)

    def _determine_event_type(
        self,
        prev_side: int,
        curr_side: int,
        prev_pos: Tuple[float, float],
        curr_pos: Tuple[float, float],
    ) -> Optional[str]:
        """
        Evaluates whether a side transition corresponds to an 'entry' or 'exit'.
        Uses movement displacement vector dotted with the target direction.
        """
        dx = curr_pos[0] - prev_pos[0]
        dy = curr_pos[1] - prev_pos[1]

        if self.entry_direction == "down":
            # Downward movement (dy > 0 or transitioning from above line to below line)
            if prev_side == -1 and curr_side == 1:
                return "entry"
            elif prev_side == 1 and curr_side == -1:
                return "exit"
            elif dy > 0:
                return "entry"
            elif dy < 0:
                return "exit"

        elif self.entry_direction == "up":
            # Upward movement (dy < 0 or transitioning from below line to above line)
            if prev_side == 1 and curr_side == -1:
                return "entry"
            elif prev_side == -1 and curr_side == 1:
                return "exit"
            elif dy < 0:
                return "entry"
            elif dy > 0:
                return "exit"

        elif self.entry_direction == "right":
            # Rightward movement (dx > 0)
            if prev_side == 1 and curr_side == -1:
                return "entry"
            elif prev_side == -1 and curr_side == 1:
                return "exit"
            elif dx > 0:
                return "entry"
            elif dx < 0:
                return "exit"

        elif self.entry_direction == "left":
            # Leftward movement (dx < 0)
            if prev_side == -1 and curr_side == 1:
                return "entry"
            elif prev_side == 1 and curr_side == -1:
                return "exit"
            elif dx < 0:
                return "entry"
            elif dx > 0:
                return "exit"

        elif self.entry_direction == "positive":
            if prev_side == -1 and curr_side == 1:
                return "entry"
            elif prev_side == 1 and curr_side == -1:
                return "exit"

        elif self.entry_direction == "negative":
            if prev_side == 1 and curr_side == -1:
                return "entry"
            elif prev_side == -1 and curr_side == 1:
                return "exit"

        return None

    def _find_matching_lost_track(
        self,
        curr_pos: Tuple[float, float],
        curr_side: int,
        frame_idx: int,
        max_dist: float = 80.0,
        max_frame_gap: int = 25,
    ) -> Optional[Dict[str, Any]]:
        """
        Recovers tracking continuity across temporary occlusions and tracker ID switches.
        Matches an appearing track with a recently lost track that was on the opposite side of the line.
        """
        for lost in reversed(self.recent_lost_tracks):
            if lost.get("matched", False):
                continue
            if frame_idx - lost["frame_idx"] > max_frame_gap:
                continue

            # Must have been on opposite side or heading across
            if lost["side"] != 0 and curr_side != 0 and lost["side"] != curr_side:
                dist = math.hypot(curr_pos[0] - lost["pos"][0], curr_pos[1] - lost["pos"][1])
                if dist <= max_dist:
                    return lost
        return None

    def update(
        self,
        track_id: int,
        bbox: Tuple[float, float, float, float],
        frame_idx: int = 0,
        timestamp: Optional[float] = None,
    ) -> Optional[str]:
        """
        Updates the tracking state for a given track ID and checks for line crossings.

        Returns:
            Optional[str]: 'entry', 'exit', or None if no crossing was recorded.
        """
        if track_id is None or track_id < 0:
            return None

        curr_pos = self._get_anchor_point(bbox)
        curr_side = self.line.side_of_line(curr_pos)
        dist_to_line = self.line.signed_distance(curr_pos)

        # Check if new track ID should be stitched from a recently lost track
        if track_id not in self.tracks:
            matched_lost = self._find_matching_lost_track(curr_pos, curr_side, frame_idx)
            if matched_lost:
                matched_lost["matched"] = True
                stitched_id = matched_lost["track_id"]
                prev_pos = matched_lost["pos"]
                prev_side = matched_lost["side"]
                logger.info(
                    "[%s] Track stitching: New Track ID %d stitched with lost Track ID %d (gap=%d frames, dist=%.1fpx)",
                    self.run_id, track_id, stitched_id, frame_idx - matched_lost["frame_idx"],
                    math.hypot(curr_pos[0] - prev_pos[0], curr_pos[1] - prev_pos[1]),
                )
                state = TrackState(
                    track_id=track_id,
                    last_known_side=prev_side,
                    last_position=prev_pos,
                    last_count_frame=matched_lost.get("last_count_frame", -9999),
                    first_seen_frame=frame_idx,
                    last_seen_frame=frame_idx,
                    stitched_from=stitched_id,
                )
                state.history.append(prev_pos)
                state.history.append(curr_pos)
                self.tracks[track_id] = state
            else:
                self.tracks[track_id] = TrackState(
                    track_id=track_id,
                    last_known_side=curr_side if curr_side != 0 else 0,
                    last_position=curr_pos,
                    last_count_frame=-9999,
                    first_seen_frame=frame_idx,
                    last_seen_frame=frame_idx,
                )
                self.tracks[track_id].history.append(curr_pos)
                return None

        state = self.tracks[track_id]
        prev_pos = state.last_position or curr_pos
        state.history.append(curr_pos)
        state.last_position = curr_pos
        state.last_seen_frame = frame_idx

        # If point is currently within the deadzone, keep history and return
        if curr_side == 0:
            return None

        # Determine prior side
        prev_side = state.last_known_side
        if prev_side == 0:
            # Track was first observed inside the deadzone. Check movement from initial position
            if len(state.history) > 1:
                init_dist = self.line.signed_distance(state.history[0])
                if (init_dist < -1e-4 and curr_side == 1) or (init_dist > 1e-4 and curr_side == -1):
                    prev_side = -1 if init_dist < 0 else 1
                else:
                    state.last_known_side = curr_side
                    return None
            else:
                state.last_known_side = curr_side
                return None

        event_type: Optional[str] = None
        has_crossed = (prev_side != curr_side) or self.line.intersects_segment(prev_pos, curr_pos)

        if has_crossed:
            frames_since_count = frame_idx - state.last_count_frame
            if frames_since_count >= self.debounce_frames:
                event_type = self._determine_event_type(prev_side, curr_side, prev_pos, curr_pos)

                if event_type is not None:
                    # Update track state
                    state.last_count_frame = frame_idx
                    state.last_event_type = event_type
                    state.counted_crossings += 1

                    event_id = 0
                    if event_type == "entry":
                        self.total_entries += 1
                        if self.counter is not None:
                            event_id = self.counter.record_entry(
                                count=1,
                                note=f"video_track_id_{track_id}",
                                persist=True,
                            )
                    elif event_type == "exit":
                        self.total_exits += 1
                        if self.counter is not None:
                            event_id = self.counter.record_exit(
                                count=1,
                                note=f"video_track_id_{track_id}",
                                persist=True,
                            )

                    self.crossing_events.append({
                        "track_id": track_id,
                        "event_type": event_type,
                        "frame_idx": frame_idx,
                        "position": curr_pos,
                        "timestamp": timestamp or time.time(),
                        "event_id": event_id,
                    })

                    logger.info(
                        "[%s] [CROSSING ACCEPTED] Frame %d: Track ID %d crossed line (side %d -> %d, %s) | pos=(%.1f, %.1f), dist=%.1f | Run Entries=%d, Run Exits=%d | DB Event ID #%d",
                        self.run_id, frame_idx, track_id, prev_side, curr_side, event_type.upper(),
                        curr_pos[0], curr_pos[1], dist_to_line,
                        self.total_entries, self.total_exits, event_id,
                    )
                    state.last_known_side = curr_side
            else:
                logger.debug(
                    "[%s] [CROSSING REJECTED] Frame %d: Track ID %d crossing rejected due to debounce (%d < %d frames)",
                    self.run_id, frame_idx, track_id, frames_since_count, self.debounce_frames,
                )

        return event_type

    def update_lost_tracks(self, active_track_ids: Set[int], current_frame: int) -> None:
        """Maintains the recent lost tracks buffer for tracking continuity."""
        for tid, state in list(self.tracks.items()):
            if tid not in active_track_ids:
                if (current_frame - state.last_seen_frame) <= 25 and state.last_position is not None:
                    # Only add if not already in lost tracks
                    if not any(lt["track_id"] == tid for lt in self.recent_lost_tracks):
                        self.recent_lost_tracks.append({
                            "track_id": tid,
                            "pos": state.last_position,
                            "side": state.last_known_side,
                            "frame_idx": state.last_seen_frame,
                            "last_count_frame": state.last_count_frame,
                            "matched": False,
                        })

    def reset(self) -> None:
        """Resets all tracking states and counter tallies."""
        self.tracks.clear()
        self.recent_lost_tracks.clear()
        self.total_entries = 0
        self.total_exits = 0
        self.crossing_events.clear()


class VideoProcessor:
    """
    Orchestrates YOLO person detection, ByteTrack tracking, and virtual-line
    crossing logic frame-by-frame on a local video source.
    """

    def __init__(
        self,
        counter: Optional[OccupancyCounter] = None,
        model_name: str = "yolov8n.pt",
        tracker: str = "bytetrack.yaml",
        conf_threshold: float = 0.25,
        line_coords: Optional[Tuple[int, int, int, int]] = None,
        line_position: float = 0.5,
        entry_direction: str = "down",
        debounce_frames: int = 15,
        point_mode: str = "center",
        save_debug_video: bool = False,
        run_id: Optional[str] = None,
    ):
        self.counter = counter
        self.model_name = model_name
        self.tracker = tracker
        self.conf_threshold = conf_threshold
        self.line_coords = line_coords
        self.line_position = max(0.0, min(1.0, line_position))
        self.entry_direction = entry_direction
        self.debounce_frames = debounce_frames
        self.point_mode = point_mode
        self.save_debug_video = save_debug_video
        self.run_id = run_id or f"run_{uuid.uuid4().hex[:6]}"

        self.stop_requested = False
        self.is_running = False
        self.crossing_counter: Optional[LineCrossingCounter] = None
        self.starting_occupancy: int = 0

    def stop(self) -> None:
        """Requests the processing loop to stop gracefully."""
        self.stop_requested = True

    def _init_crossing_counter(self, frame_width: int, frame_height: int) -> LineCrossingCounter:
        """Configures the VirtualLine and LineCrossingCounter based on video dimensions."""
        if self.line_coords:
            x1, y1, x2, y2 = self.line_coords
            # Check if line_coords are normalized [0.0, 1.0] or absolute pixels
            if all(0.0 <= c <= 1.0 for c in (x1, y1, x2, y2)) and (x2 <= 1.0 and y2 <= 1.0):
                x1 = int(x1 * frame_width)
                x2 = int(x2 * frame_width)
                y1 = int(y1 * frame_height)
                y2 = int(y2 * frame_height)
            line = VirtualLine(pt1=(int(x1), int(y1)), pt2=(int(x2), int(y2)))
        else:
            # Horizontal line across frame width at line_position
            line_y = int(frame_height * self.line_position)
            line = VirtualLine(pt1=(0, line_y), pt2=(frame_width, line_y))

        return LineCrossingCounter(
            line=line,
            entry_direction=self.entry_direction,
            debounce_frames=self.debounce_frames,
            counter=self.counter,
            point_mode=self.point_mode,
            run_id=self.run_id,
        )

    def process_video(
        self,
        video_path: str,
        max_frames: Optional[int] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Processes a local video file frame by frame.

        Returns:
            Dict[str, Any]: Execution summary including frames processed, entries, exits, and final stats.
        """
        if not os.path.isfile(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video file: {video_path}")

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        if width <= 0 or height <= 0:
            cap.release()
            raise ValueError(f"Invalid video dimensions ({width}x{height}) in file: {video_path}")

        # Lazy load YOLO model
        from ultralytics import YOLO
        model = YOLO(self.model_name)

        self.crossing_counter = self._init_crossing_counter(width, height)
        self.stop_requested = False
        self.is_running = True
        self.starting_occupancy = self.counter.current_occupancy if self.counter else 0

        line_desc = (
            f"coords={self.line_coords}"
            if self.line_coords
            else f"y={self.crossing_counter.line.pt1[1]} ({int(self.line_position * 100)}% of {height}px)"
        )
        logger.info(
            "[%s] STARTING video processing on '%s' | %dx%d, %d frames @ %.1f FPS | line=[%s], dir=%s, mode=%s, conf=%.2f | starting_occupancy=%d",
            self.run_id, os.path.basename(video_path), width, height, total_frames, fps,
            line_desc, self.entry_direction, self.point_mode, self.conf_threshold, self.starting_occupancy,
        )

        debug_writer = None
        debug_video_path = None
        if self.save_debug_video:
            base_dir = os.path.dirname(os.path.abspath(video_path))
            filename = f"debug_{os.path.basename(video_path)}"
            debug_video_path = os.path.join(base_dir, filename)
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            debug_writer = cv2.VideoWriter(debug_video_path, fourcc, fps, (width, height))

        processed_frames = 0
        start_time = time.time()
        recent_crossing_label = ""
        recent_crossing_expiry = 0
        unique_track_ids: Set[int] = set()

        try:
            while cap.isOpened() and not self.stop_requested:
                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                processed_frames += 1

                # Track people only (COCO class 0 = person) with ByteTrack
                results = model.track(
                    source=frame,
                    persist=True,
                    classes=[0],
                    conf=self.conf_threshold,
                    tracker=self.tracker,
                    verbose=False,
                )

                frame_events = []
                annotated_boxes = []
                active_tids_in_frame: Set[int] = set()

                if results and len(results) > 0 and results[0].boxes is not None:
                    boxes = results[0].boxes
                    track_ids = boxes.id

                    if track_ids is not None:
                        ids_list = track_ids.int().cpu().tolist()
                        xyxy_list = boxes.xyxy.cpu().tolist()
                        confs_list = boxes.conf.cpu().tolist() if boxes.conf is not None else [1.0] * len(ids_list)

                        for tid, bbox, conf_score in zip(ids_list, xyxy_list, confs_list):
                            if tid is not None and tid >= 0:
                                tid_int = int(tid)
                                active_tids_in_frame.add(tid_int)
                                unique_track_ids.add(tid_int)
                                evt = self.crossing_counter.update(
                                    track_id=tid_int,
                                    bbox=tuple(bbox),
                                    frame_idx=processed_frames,
                                    timestamp=time.time(),
                                )
                                if evt:
                                    frame_events.append((tid_int, evt))
                                    recent_crossing_label = f"+1 {evt.upper()} (ID: {tid_int})"
                                    recent_crossing_expiry = processed_frames + 25

                                if debug_writer:
                                    annotated_boxes.append((tid_int, bbox, conf_score))

                # Update lost tracks buffer for tracking continuity
                self.crossing_counter.update_lost_tracks(active_tids_in_frame, processed_frames)

                # Render debug annotated video frame if enabled
                if debug_writer is not None:
                    dbg_frame = frame.copy()
                    pt1 = self.crossing_counter.line.pt1
                    pt2 = self.crossing_counter.line.pt2
                    cv2.line(dbg_frame, pt1, pt2, (0, 255, 255), 2)
                    dir_indicator = f"Doorway Line ({self.entry_direction.upper()}=Entry)"
                    cv2.putText(dbg_frame, dir_indicator, (pt1[0] + 15, max(25, pt1[1] - 8)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 2)

                    for tid, bbox, conf_score in annotated_boxes:
                        x1, y1, x2, y2 = [int(v) for v in bbox]
                        cx = int((x1 + x2) / 2)
                        cy = int((y1 + y2) / 2) if self.point_mode == "center" else int(y2)
                        cv2.rectangle(dbg_frame, (x1, y1), (x2, y2), (40, 200, 40), 2)
                        cv2.circle(dbg_frame, (cx, cy), 5, (0, 140, 255), -1)
                        cv2.putText(dbg_frame, f"ID:{tid} ({conf_score:.2f})", (x1, max(18, y1 - 6)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (40, 255, 40), 2)

                    hud_text = (
                        f"Frames: {processed_frames}/{total_frames} | "
                        f"Run Entries: {self.crossing_counter.total_entries} | "
                        f"Run Exits: {self.crossing_counter.total_exits}"
                    )
                    cv2.rectangle(dbg_frame, (10, 10), (min(width - 10, 520), 45), (30, 30, 30), -1)
                    cv2.putText(dbg_frame, hud_text, (20, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                    if recent_crossing_label and processed_frames < recent_crossing_expiry:
                        is_entry = "ENTRY" in recent_crossing_label
                        color = (40, 220, 40) if is_entry else (40, 40, 240)
                        cv2.putText(dbg_frame, recent_crossing_label, (20, 75),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

                    debug_writer.write(dbg_frame)

                elapsed = max(1e-4, time.time() - start_time)
                current_fps = round(processed_frames / elapsed, 1)

                if processed_frames % 50 == 0 or processed_frames == total_frames:
                    logger.info(
                        "[%s] Progress: %d/%d frames (%.1f%%) | %.1f FPS | Tracks=%d | Run Entries=%d | Run Exits=%d",
                        self.run_id, processed_frames, total_frames, (processed_frames / max(1, total_frames)) * 100,
                        current_fps, len(unique_track_ids),
                        self.crossing_counter.total_entries, self.crossing_counter.total_exits,
                    )

                if progress_callback:
                    run_entries = self.crossing_counter.total_entries
                    run_exits = self.crossing_counter.total_exits
                    run_occ = max(0, self.starting_occupancy + run_entries - run_exits)
                    progress_callback({
                        "processed_frames": processed_frames,
                        "total_frames": total_frames,
                        "progress_percentage": round((processed_frames / max(1, total_frames)) * 100.0, 1),
                        "entries": run_entries,
                        "exits": run_exits,
                        "starting_occupancy": self.starting_occupancy,
                        "run_occupancy": run_occ,
                        "fps": current_fps,
                    })

                if max_frames and processed_frames >= max_frames:
                    break

        finally:
            cap.release()
            if debug_writer is not None:
                debug_writer.release()
            self.is_running = False

        duration = round(time.time() - start_time, 2)
        run_entries = self.crossing_counter.total_entries
        run_exits = self.crossing_counter.total_exits
        run_occ = max(0, self.starting_occupancy + run_entries - run_exits)

        logger.info(
            "[%s] FINISHED video '%s' in %.2fs (%.1f FPS) | %d/%d frames | Run Entries=%d, Run Exits=%d | Starting Occupancy=%d, Final Run Occupancy=%d",
            self.run_id, os.path.basename(video_path), duration, round(processed_frames / max(1e-4, duration), 1),
            processed_frames, total_frames, run_entries, run_exits, self.starting_occupancy, run_occ,
        )
        summary = {
            "status": "stopped" if self.stop_requested else "completed",
            "run_id": self.run_id,
            "video_path": video_path,
            "total_frames": total_frames,
            "processed_frames": processed_frames,
            "duration_seconds": duration,
            "average_fps": round(processed_frames / max(1e-4, duration), 1),
            "starting_occupancy": self.starting_occupancy,
            "run_occupancy": run_occ,
            "entries_detected": run_entries,
            "exits_detected": run_exits,
            "point_mode": self.point_mode,
            "debug_video_path": debug_video_path if self.save_debug_video else None,
            "occupancy_stats": self.counter.get_stats() if self.counter else None,
        }
        return summary


class VideoJobManager:
    """
    Manages asynchronous, non-blocking video processing jobs in a background thread.
    Ensures that long video processing does not block FastAPI health or stats requests.
    Maintains clean separation between run-specific counts and historical counter state.
    """

    def __init__(self, counter: OccupancyCounter):
        self.counter = counter
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._processor: Optional[VideoProcessor] = None

        self._status: str = "idle"
        self._error: Optional[str] = None
        self._video_path: Optional[str] = None
        self._run_id: Optional[str] = None
        self._starting_occupancy: int = 0
        self._run_occupancy: int = 0
        self._total_frames: int = 0
        self._processed_frames: int = 0
        self._progress_percentage: float = 0.0
        self._entries_detected: int = 0
        self._exits_detected: int = 0
        self._current_fps: float = 0.0
        self._debug_video_path: Optional[str] = None
        self._point_mode: str = "center"

    def get_status(self) -> Dict[str, Any]:
        """Returns the current background job status and occupancy stats."""
        with self._lock:
            return {
                "status": self._status,
                "video_path": self._video_path,
                "run_id": self._run_id,
                "starting_occupancy": self._starting_occupancy,
                "run_occupancy": self._run_occupancy,
                "total_frames": self._total_frames,
                "processed_frames": self._processed_frames,
                "progress_percentage": self._progress_percentage,
                "entries_detected": self._entries_detected,
                "exits_detected": self._exits_detected,
                "current_fps": self._current_fps,
                "error_message": self._error,
                "debug_video_path": self._debug_video_path,
                "point_mode": self._point_mode,
                "stats": self.counter.get_stats(),
            }

    def _progress_listener(self, progress: Dict[str, Any]) -> None:
        """Internal callback invoked per frame from the processing thread."""
        with self._lock:
            self._processed_frames = progress.get("processed_frames", 0)
            self._total_frames = progress.get("total_frames", 0)
            self._progress_percentage = progress.get("progress_percentage", 0.0)
            self._entries_detected = progress.get("entries", 0)
            self._exits_detected = progress.get("exits", 0)
            self._starting_occupancy = progress.get("starting_occupancy", self._starting_occupancy)
            self._run_occupancy = progress.get("run_occupancy", max(0, self._starting_occupancy + self._entries_detected - self._exits_detected))
            self._current_fps = progress.get("fps", 0.0)

    def _run_worker(self, processor: VideoProcessor, video_path: str, max_frames: Optional[int]) -> None:
        """Worker thread entrypoint."""
        try:
            summary = processor.process_video(
                video_path=video_path,
                max_frames=max_frames,
                progress_callback=self._progress_listener,
            )
            with self._lock:
                self._status = summary.get("status", "completed")
                self._entries_detected = summary.get("entries_detected", 0)
                self._exits_detected = summary.get("exits_detected", 0)
                self._starting_occupancy = summary.get("starting_occupancy", self._starting_occupancy)
                self._run_occupancy = summary.get("run_occupancy", max(0, self._starting_occupancy + self._entries_detected - self._exits_detected))
                self._processed_frames = summary.get("processed_frames", 0)
                self._total_frames = summary.get("total_frames", self._total_frames)
                self._progress_percentage = 100.0 if self._status == "completed" else self._progress_percentage
                self._debug_video_path = summary.get("debug_video_path")
        except Exception as exc:
            logger.exception("[%s] Video processing worker error: %s", getattr(processor, "run_id", "unknown"), exc)
            with self._lock:
                self._status = "failed"
                self._error = str(exc)

    def start_job(
        self,
        video_path: str,
        line_coords: Optional[Tuple[int, int, int, int]] = None,
        line_position: float = 0.5,
        entry_direction: str = "down",
        conf_threshold: float = 0.25,
        model_name: str = "yolov8n.pt",
        max_frames: Optional[int] = None,
        point_mode: str = "center",
        save_debug_video: bool = False,
    ) -> Dict[str, Any]:
        """
        Validates parameters and starts video processing in a background daemon thread.
        Guarantees that run metrics are isolated to this specific execution.
        """
        with self._lock:
            if self._status == "running":
                raise RuntimeError("A video processing job is already running.")

            if not os.path.isfile(video_path):
                raise FileNotFoundError(f"Video file not found: {video_path}")

            run_id = f"run_{uuid.uuid4().hex[:6]}"
            starting_occ = self.counter.current_occupancy

            logger.info(
                "[JOB %s] Initializing video processing for '%s' | Starting Occupancy=%d",
                run_id, os.path.basename(video_path), starting_occ
            )

            self._processor = VideoProcessor(
                counter=self.counter,
                model_name=model_name,
                line_coords=line_coords,
                line_position=line_position,
                entry_direction=entry_direction,
                conf_threshold=conf_threshold,
                point_mode=point_mode,
                save_debug_video=save_debug_video,
                run_id=run_id,
            )

            self._run_id = run_id
            self._status = "running"
            self._error = None
            self._video_path = video_path
            self._starting_occupancy = starting_occ
            self._run_occupancy = starting_occ
            self._total_frames = 0
            self._processed_frames = 0
            self._progress_percentage = 0.0
            self._entries_detected = 0
            self._exits_detected = 0
            self._current_fps = 0.0
            self._debug_video_path = None
            self._point_mode = point_mode

            self._thread = threading.Thread(
                target=self._run_worker,
                args=(self._processor, video_path, max_frames),
                daemon=True,
            )
            self._thread.start()

        return self.get_status()

    def stop_job(self) -> Dict[str, Any]:
        """Stops an active video processing job."""
        with self._lock:
            if self._processor and self._status == "running":
                self._processor.stop()
                self._status = "stopping"
        return self.get_status()
