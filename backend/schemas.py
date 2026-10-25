"""
CrowdSense AI - Pydantic Schemas
Defines request and response data models for API validation and documentation.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field("ok", description="Operational status of the API")
    app: str = Field("CrowdSense AI", description="Application name")
    version: str = Field("1.0.0", description="API version")


class StatsResponse(BaseModel):
    total_entries: int = Field(..., ge=0, description="Total number of people who entered")
    total_exits: int = Field(..., ge=0, description="Total number of people who exited")
    current_occupancy: int = Field(..., ge=0, description="Current number of people inside")
    peak_occupancy: int = Field(..., ge=0, description="Highest occupancy recorded during the session")
    capacity: int = Field(..., ge=1, description="Maximum venue capacity")
    capacity_percentage: float = Field(..., ge=0.0, description="Current occupancy as a percentage of capacity")
    status: str = Field(..., description="Descriptive status (e.g. Normal, Moderate, Near Capacity, At Capacity)")
    available_spaces: Optional[int] = Field(None, description="Number of remaining available spaces in venue")


class EventTriggerRequest(BaseModel):
    count: int = Field(1, ge=1, description="Number of people entering or exiting")
    note: Optional[str] = Field(None, description="Optional note or detection metadata")


class EventItem(BaseModel):
    id: int
    event_type: str
    count: int
    timestamp: str
    note: Optional[str] = None


class EventListResponse(BaseModel):
    events: List[EventItem]
    total_count: int


class EventActionResponse(BaseModel):
    message: str
    event_id: int
    stats: StatsResponse


class ResetResponse(BaseModel):
    message: str
    stats: StatsResponse


class VideoProcessRequest(BaseModel):
    video_path: str = Field(..., description="Absolute or relative path to the local video file")
    line_position: Optional[float] = Field(0.5, ge=0.0, le=1.0, description="Relative position of horizontal virtual line (0.0=top, 1.0=bottom)")
    line_coords: Optional[List[int]] = Field(None, description="Optional explicit coordinates [x1, y1, x2, y2]")
    entry_direction: str = Field("down", description="Direction for entry: 'down', 'up', 'right', 'left', 'positive', 'negative'")
    conf_threshold: float = Field(0.25, ge=0.0, le=1.0, description="YOLO detection confidence threshold")
    model_name: str = Field("yolov8n.pt", description="YOLO model name or weights path")
    max_frames: Optional[int] = Field(None, ge=1, description="Optional frame limit for processing")
    point_mode: str = Field("center", description="Anchor point: 'center' (centroid) or 'bottom_center' (feet)")
    save_debug_video: bool = Field(False, description="Whether to export an annotated debug video")


class VideoProcessStatusResponse(BaseModel):
    status: str = Field(..., description="Job status: idle, running, stopping, completed, failed")
    video_path: Optional[str] = Field(None, description="Path of video currently being processed or last processed")
    total_frames: int = Field(0, description="Total frames in video file")
    processed_frames: int = Field(0, description="Frames processed so far")
    progress_percentage: float = Field(0.0, description="Completion percentage")
    entries_detected: int = Field(0, description="Total entries detected in this video run")
    exits_detected: int = Field(0, description="Total exits detected in this video run")
    starting_occupancy: Optional[int] = Field(0, description="Occupancy before this video run started")
    run_occupancy: Optional[int] = Field(0, description="Calculated live occupancy for this run: max(0, starting_occupancy + entries - exits)")
    current_fps: float = Field(0.0, description="Current processing speed in FPS")
    error_message: Optional[str] = Field(None, description="Error details if job failed")
    debug_video_path: Optional[str] = Field(None, description="Path to generated debug video if requested")
    point_mode: Optional[str] = Field("center", description="Anchor point used for detection")
    run_id: Optional[str] = Field(None, description="Unique run identifier for the processing job")
    stats: Optional[StatsResponse] = Field(None, description="Current venue occupancy statistics")


class VideoUploadResponse(BaseModel):
    message: str = Field("Video uploaded and validated successfully.", description="Status message")
    filename: str = Field(..., description="Unique server-generated filename")
    video_path: str = Field(..., description="Absolute path to the saved video file")
    size_bytes: int = Field(..., ge=1, description="Size of the uploaded video in bytes")
