"""
CrowdSense AI - Video Processing & Footfall Counting Engine
Integrates Ultralytics YOLO person detection, ByteTrack tracking,
virtual-line crossing detection, duplicate prevention, and background processing.
"""

from collections import deque
from dataclasses import dataclass, field
import math
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

from backend.counter import OccupancyCounter


@dataclass
class VirtualLine:
    """
    Represents a virtual crossing line segment between pt1 and pt2.
    Includes a deadzone margin (in pixels) to prevent boundary oscillation noise.
    """
    pt1: Tuple[int, int]
    pt2: Tuple[int, int]
    margin: float = 6.0

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


@dataclass
class TrackState:
    """Maintains trajectory and crossing state for an individual tracking ID."""
    track_id: int
    last_known_side: int = 0
    last_position: Optional[Tuple[float, float]] = None
    last_count_frame: int = -9999
    last_event_type: Optional[str] = None
    history: deque = field(default_factory=lambda: deque(maxlen=30))
    counted_crossings: int = 0


class LineCrossingCounter:
    """
    Detects directional line crossings from tracked object trajectories.
    Prevents duplicate counts through debounce windows, hysteresis deadzones,
    and state-transition locks.
    """

    def __init__(
        self,
        line: VirtualLine,
        entry_direction: str = "down",
        debounce_frames: int = 25,
        counter: Optional[OccupancyCounter] = None,
        point_mode: str = "bottom_center",
    ):
        """
        Args:
            line: VirtualLine defining the crossing threshold.
            entry_direction: Direction defining an entry:
                - "down": moving downward (increasing Y) is entry, upward is exit.
                - "up": moving upward (decreasing Y) is entry, downward is exit.
                - "right": moving rightward (increasing X) is entry, leftward is exit.
                - "left": moving leftward (decreasing X) is entry, rightward is exit.
                - "positive": crossing from side -1 to +1 is entry.
                - "negative": crossing from side +1 to -1 is entry.
            debounce_frames: Minimum frame gap required before the same track ID can be counted again.
            counter: Optional OccupancyCounter to directly record entry/exit events.
            point_mode: Detection anchor: 'bottom_center' (feet position) or 'center' (bbox centroid).
        """
        self.line = line
        self.entry_direction = entry_direction.lower()
        self.debounce_frames = debounce_frames
        self.counter = counter
        self.point_mode = point_mode

        self.tracks: Dict[int, TrackState] = {}
        self.total_entries: int = 0
        self.total_exits: int = 0
        self.crossing_events: List[Dict[str, Any]] = []

    def _get_anchor_point(self, bbox: Tuple[float, float, float, float]) -> Tuple[float, float]:
        """Calculates either centroid or bottom-center (ground plane/feet) from bbox."""
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
            else:
                return "exit"

        elif self.entry_direction == "up":
            # Upward movement (dy < 0 or transitioning from below line to above line)
            if prev_side == 1 and curr_side == -1:
                return "entry"
            elif prev_side == -1 and curr_side == 1:
                return "exit"
            elif dy < 0:
                return "entry"
            else:
                return "exit"

        elif self.entry_direction == "right":
            # Rightward movement (dx > 0)
            if prev_side == 1 and curr_side == -1:
                return "entry"
            elif prev_side == -1 and curr_side == 1:
                return "exit"
            elif dx > 0:
                return "entry"
            else:
                return "exit"

        elif self.entry_direction == "left":
            # Leftward movement (dx < 0)
            if prev_side == -1 and curr_side == 1:
                return "entry"
            elif prev_side == 1 and curr_side == -1:
                return "exit"
            elif dx < 0:
                return "entry"
            else:
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

        if track_id not in self.tracks:
            self.tracks[track_id] = TrackState(
                track_id=track_id,
                last_known_side=curr_side if curr_side != 0 else 0,
                last_position=curr_pos,
                last_count_frame=-9999,
            )
            self.tracks[track_id].history.append(curr_pos)
            return None

        state = self.tracks[track_id]
        prev_pos = state.last_position or curr_pos
        state.history.append(curr_pos)
        state.last_position = curr_pos

        # If point is currently within the deadzone, keep the last known side
        if curr_side == 0:
            return None

        # Check if the object transitioned across the line from one side to the opposite
        prev_side = state.last_known_side
        if prev_side == 0:
            state.last_known_side = curr_side
            return None

        event_type: Optional[str] = None
        if prev_side != curr_side:
            # Check debounce frames to prevent repeated counts from jitter
            if (frame_idx - state.last_count_frame) >= self.debounce_frames:
                event_type = self._determine_event_type(prev_side, curr_side, prev_pos, curr_pos)

                if event_type is not None:
                    # Update track state
                    state.last_count_frame = frame_idx
                    state.last_event_type = event_type
                    state.counted_crossings += 1

                    # Update internal counts
                    if event_type == "entry":
                        self.total_entries += 1
                        if self.counter is not None:
                            self.counter.record_entry(
                                count=1,
                                note=f"video_track_id_{track_id}",
                                persist=True,
                            )
                    elif event_type == "exit":
                        self.total_exits += 1
                        if self.counter is not None:
                            self.counter.record_exit(
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
                    })

                # Update side after crossing check when debounce has elapsed
                state.last_known_side = curr_side

        return event_type

    def reset(self) -> None:
        """Resets all tracking states and counter tallies."""
        self.tracks.clear()
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
        debounce_frames: int = 25,
        point_mode: str = "bottom_center",
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

        self.stop_requested = False
        self.is_running = False
        self.crossing_counter: Optional[LineCrossingCounter] = None

    def stop(self) -> None:
        """Requests the processing loop to stop gracefully."""
        self.stop_requested = True

    def _init_crossing_counter(self, frame_width: int, frame_height: int) -> LineCrossingCounter:
        """Configures the VirtualLine and LineCrossingCounter based on video dimensions."""
        if self.line_coords:
            x1, y1, x2, y2 = self.line_coords
            line = VirtualLine(pt1=(x1, y1), pt2=(x2, y2))
        else:
            # Default horizontal line across frame width at line_position
            line_y = int(frame_height * self.line_position)
            line = VirtualLine(pt1=(0, line_y), pt2=(frame_width, line_y))

        return LineCrossingCounter(
            line=line,
            entry_direction=self.entry_direction,
            debounce_frames=self.debounce_frames,
            counter=self.counter,
            point_mode=self.point_mode,
        )

    def process_video(
        self,
        video_path: str,
        max_frames: Optional[int] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Processes a local video file frame by frame.

        Args:
            video_path: Path to the video file.
            max_frames: Optional maximum number of frames to process (useful for testing).
            progress_callback: Optional callback reporting per-frame progress.

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

        processed_frames = 0
        start_time = time.time()

        try:
            while cap.isOpened() and not self.stop_requested:
                ret, frame = cap.read()
                if not ret or frame is None:
                    # End of video reached gracefully
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

                if results and len(results) > 0 and results[0].boxes is not None:
                    boxes = results[0].boxes
                    track_ids = boxes.id

                    if track_ids is not None:
                        ids_list = track_ids.int().cpu().tolist()
                        xyxy_list = boxes.xyxy.cpu().tolist()

                        for tid, bbox in zip(ids_list, xyxy_list):
                            if tid is not None and tid >= 0:
                                self.crossing_counter.update(
                                    track_id=int(tid),
                                    bbox=tuple(bbox),
                                    frame_idx=processed_frames,
                                    timestamp=time.time(),
                                )

                elapsed = max(1e-4, time.time() - start_time)
                current_fps = round(processed_frames / elapsed, 1)

                if progress_callback:
                    progress_callback({
                        "processed_frames": processed_frames,
                        "total_frames": total_frames,
                        "progress_percentage": round((processed_frames / max(1, total_frames)) * 100.0, 1),
                        "entries": self.crossing_counter.total_entries,
                        "exits": self.crossing_counter.total_exits,
                        "fps": current_fps,
                    })

                if max_frames and processed_frames >= max_frames:
                    break

        finally:
            cap.release()
            self.is_running = False

        duration = round(time.time() - start_time, 2)
        summary = {
            "status": "stopped" if self.stop_requested else "completed",
            "video_path": video_path,
            "total_frames": total_frames,
            "processed_frames": processed_frames,
            "duration_seconds": duration,
            "average_fps": round(processed_frames / max(1e-4, duration), 1),
            "entries_detected": self.crossing_counter.total_entries,
            "exits_detected": self.crossing_counter.total_exits,
            "occupancy_stats": self.counter.get_stats() if self.counter else None,
        }
        return summary


class VideoJobManager:
    """
    Manages asynchronous, non-blocking video processing jobs in a background thread.
    Ensures that long video processing does not block FastAPI health or stats requests.
    """

    def __init__(self, counter: OccupancyCounter):
        self.counter = counter
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._processor: Optional[VideoProcessor] = None

        self._status: str = "idle"
        self._error: Optional[str] = None
        self._video_path: Optional[str] = None
        self._total_frames: int = 0
        self._processed_frames: int = 0
        self._progress_percentage: float = 0.0
        self._entries_detected: int = 0
        self._exits_detected: int = 0
        self._current_fps: float = 0.0

    def get_status(self) -> Dict[str, Any]:
        """Returns the current background job status and occupancy stats."""
        with self._lock:
            return {
                "status": self._status,
                "video_path": self._video_path,
                "total_frames": self._total_frames,
                "processed_frames": self._processed_frames,
                "progress_percentage": self._progress_percentage,
                "entries_detected": self._entries_detected,
                "exits_detected": self._exits_detected,
                "current_fps": self._current_fps,
                "error_message": self._error,
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
                self._processed_frames = summary.get("processed_frames", 0)
        except Exception as exc:
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
    ) -> Dict[str, Any]:
        """
        Validates parameters and starts video processing in a background daemon thread.
        """
        with self._lock:
            if self._status == "running":
                raise RuntimeError("A video processing job is already running.")

            if not os.path.isfile(video_path):
                raise FileNotFoundError(f"Video file not found: {video_path}")

            self._processor = VideoProcessor(
                counter=self.counter,
                model_name=model_name,
                line_coords=line_coords,
                line_position=line_position,
                entry_direction=entry_direction,
                conf_threshold=conf_threshold,
            )

            self._status = "running"
            self._error = None
            self._video_path = video_path
            self._total_frames = 0
            self._processed_frames = 0
            self._progress_percentage = 0.0
            self._entries_detected = 0
            self._exits_detected = 0
            self._current_fps = 0.0

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
