"""
CrowdSense AI - FastAPI Application
Provides REST API endpoints for occupancy tracking, statistics, and health checks.
"""

from contextlib import asynccontextmanager
import logging
import os
from typing import Optional
import uuid

import cv2
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import ClientDisconnect

# Configure logging
logger = logging.getLogger("crowdsense.api")

from backend import database
from backend.counter import OccupancyCounter
from backend.schemas import (
    EventActionResponse,
    EventItem,
    EventListResponse,
    EventTriggerRequest,
    HealthResponse,
    ResetResponse,
    StatsResponse,
    VideoProcessRequest,
    VideoProcessStatusResponse,
    VideoUploadResponse,
)
from backend.video_processor import VideoJobManager

# Global in-memory counter instance (default venue capacity: 100)
counter = OccupancyCounter(capacity=100)
video_manager = VideoJobManager(counter=counter)

# Upload configuration
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "videos")
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024  # 500 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB chunk streaming


def is_valid_video_file(file_path: str) -> bool:
    """
    Validates that the file at file_path is recognized by OpenCV as a readable video
    with valid dimensions and at least one readable frame.
    """
    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        return False
    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if width <= 0 or height <= 0:
            return False
        ret, frame = cap.read()
        if not ret or frame is None:
            return False
        return True
    except Exception:
        return False
    finally:
        cap.release()




@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.
    Initializes the SQLite database and restores counter state when the server starts.
    """
    database.init_db(counter.db_path)
    counter.restore_state()
    yield


app = FastAPI(
    title="CrowdSense AI - Backend API",
    description="Real-time occupancy detection and crowd monitoring backend for public meetings.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for local frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Global Error Boundaries & Exception Handlers
# ============================================================================

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Catches request payload and parameter validation errors, returning structured JSON.
    """
    logger.warning("Request validation failed on %s %s: %s", request.method, request.url.path, exc.errors())
    return JSONResponse(
        status_code=422,
        content={
            "error": "ValidationError",
            "message": "The request body or parameters failed validation.",
            "detail": exc.errors(),
            "status_code": 422,
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """
    Handles standard HTTP exceptions with structured JSON error details.
    Preserves 'detail' field for backwards compatibility with existing clients and tests.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "HttpException",
            "message": exc.detail if isinstance(exc.detail, str) else "HTTP Error",
            "detail": exc.detail,
            "status_code": exc.status_code,
        },
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(ClientDisconnect)
async def client_disconnect_handler(request: Request, exc: ClientDisconnect):
    """
    Gracefully handles client disconnections without crashing or dumping socket traces.
    """
    logger.info("Client disconnected during %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=499,
        content={
            "error": "ClientDisconnect",
            "message": "Client closed the connection before the request was completed.",
            "status_code": 499,
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Catch-all global error boundary for unexpected backend exceptions.
    Prevents unhandled crashes and returns standardized 500 JSON payloads.
    """
    logger.error("Unhandled exception processing %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "InternalServerError",
            "message": "An unexpected error occurred while processing your request.",
            "detail": str(exc),
            "status_code": 500,
        },
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    tags=["System"],
)
def get_health() -> HealthResponse:
    """
    Confirms the API server is up and responsive.
    """
    return HealthResponse(
        status="ok",
        app="CrowdSense AI",
        version="1.0.0",
    )


@app.get(
    "/stats",
    response_model=StatsResponse,
    summary="Get occupancy statistics",
    tags=["Occupancy"],
)
def get_stats() -> StatsResponse:
    """
    Returns current crowd statistics:
    - total_entries
    - total_exits
    - current_occupancy
    - peak_occupancy
    - capacity
    - capacity_percentage
    - status
    """
    stats_data = counter.get_stats()
    return StatsResponse(**stats_data)


@app.post(
    "/events/entry",
    response_model=EventActionResponse,
    summary="Record entry event",
    tags=["Occupancy"],
)
def record_entry(request: Optional[EventTriggerRequest] = None) -> EventActionResponse:
    """
    Records one or more people entering the meeting venue.
    Increments occupancy, updates peak occupancy, and logs the event in SQLite.
    """
    count = request.count if request else 1
    note = request.note if request else None

    event_id = counter.record_entry(count=count, note=note, persist=True)
    return EventActionResponse(
        message=f"Recorded entry of {count} person(s).",
        event_id=event_id,
        stats=StatsResponse(**counter.get_stats()),
    )


@app.post(
    "/events/exit",
    response_model=EventActionResponse,
    summary="Record exit event",
    tags=["Occupancy"],
)
def record_exit(request: Optional[EventTriggerRequest] = None) -> EventActionResponse:
    """
    Records one or more people exiting the meeting venue.
    Decrements occupancy (clamped so it never drops below 0) and logs the event in SQLite.
    """
    count = request.count if request else 1
    note = request.note if request else None

    event_id = counter.record_exit(count=count, note=note, persist=True)
    return EventActionResponse(
        message=f"Recorded exit of {count} person(s).",
        event_id=event_id,
        stats=StatsResponse(**counter.get_stats()),
    )


@app.get(
    "/events",
    response_model=EventListResponse,
    summary="Get recent events log",
    tags=["Occupancy"],
)
def get_events(limit: int = Query(50, ge=1, le=500)) -> EventListResponse:
    """
    Returns the most recent entry and exit events stored in SQLite.
    """
    raw_events = database.get_events(limit=limit, db_path=counter.db_path)
    items = [
        EventItem(
            id=e["id"],
            event_type=e["event_type"],
            count=e["count"],
            timestamp=e["timestamp"],
            note=e.get("note"),
        )
        for e in raw_events
    ]
    return EventListResponse(events=items, total_count=len(items))


@app.post(
    "/reset",
    response_model=ResetResponse,
    summary="Reset occupancy counters",
    tags=["Occupancy"],
)
def reset_counters(clear_history: bool = Query(False, description="Also delete SQLite event history")) -> ResetResponse:
    """
    Resets in-memory counters to 0. Optionally clears the SQLite database.
    """
    counter.reset(clear_db=clear_history)
    return ResetResponse(
        message="Counters have been reset successfully.",
        stats=StatsResponse(**counter.get_stats()),
    )


@app.post(
    "/video/process",
    response_model=VideoProcessStatusResponse,
    summary="Start background video processing",
    tags=["Video Processing"],
)
def start_video_processing(request: VideoProcessRequest) -> VideoProcessStatusResponse:
    """
    Initiates asynchronous video processing for footfall detection.
    Processes video frame-by-frame in a separate background thread without blocking the API.
    """
    try:
        logger.info(
            "POST /video/process: video_path='%s', line_pos=%s, dir='%s', conf=%s, mode='%s', max_frames=%s",
            request.video_path, request.line_position, request.entry_direction,
            request.conf_threshold, request.point_mode, request.max_frames,
        )
        coords = tuple(request.line_coords) if request.line_coords and len(request.line_coords) == 4 else None
        status_data = video_manager.start_job(
            video_path=request.video_path,
            line_coords=coords,
            line_position=request.line_position if request.line_position is not None else 0.5,
            entry_direction=request.entry_direction,
            conf_threshold=request.conf_threshold,
            model_name=request.model_name,
            max_frames=request.max_frames,
            point_mode=request.point_mode,
            save_debug_video=request.save_debug_video,
        )
        return VideoProcessStatusResponse(**status_data)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@app.get(
    "/video/status",
    response_model=VideoProcessStatusResponse,
    summary="Get video processing status",
    tags=["Video Processing"],
)
def get_video_status() -> VideoProcessStatusResponse:
    """
    Returns the real-time progress and status of the video processing engine.
    """
    status_data = video_manager.get_status()
    return VideoProcessStatusResponse(**status_data)



@app.get(
    "/video/debug/download",
    summary="Download annotated debug video",
    tags=["Video Processing"],
)
def download_debug_video(path: str = Query(..., description="Path to debug video file")) -> FileResponse:
    """
    Returns the annotated debug video file containing bounding boxes,
    tracker IDs, virtual doorway line, and detected crossings.
    """
    if not os.path.isfile(path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debug video not found.")
    return FileResponse(path, media_type="video/mp4", filename=os.path.basename(path))


@app.post(
    "/video/stop",
    response_model=VideoProcessStatusResponse,
    summary="Stop video processing",
    tags=["Video Processing"],
)
def stop_video_processing() -> VideoProcessStatusResponse:
    """
    Requests the ongoing background video processing task to stop gracefully.
    """
    status_data = video_manager.stop_job()
    return VideoProcessStatusResponse(**status_data)


@app.post(
    "/video/upload",
    response_model=VideoUploadResponse,
    summary="Upload and validate a video file",
    tags=["Video Processing"],
)
async def upload_video(file: UploadFile = File(...)) -> VideoUploadResponse:
    """
    Uploads a video file securely:
    - Supports .mp4, .mov, .avi, .mkv, .webm.
    - Generates a unique server-side filename (never trusts user filename).
    - Enforces maximum upload size of 500 MB with chunked streaming.
    - Rejects empty uploads and verifies video readability via OpenCV.
    - Cleans up invalid or oversized uploads immediately.
    """
    original_filename = file.filename or ""
    _, ext = os.path.splitext(original_filename)
    ext = ext.lower()

    if not ext or ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported video format: '{ext}'. Allowed formats: {', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))}",
        )

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    destination_path = os.path.abspath(os.path.join(UPLOAD_DIR, unique_filename))

    total_bytes = 0
    try:
        with open(destination_path, "wb") as buffer:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE_BYTES:
                    buffer.close()
                    if os.path.exists(destination_path):
                        os.remove(destination_path)
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail=f"Uploaded file exceeds maximum allowed size of {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB.",
                    )
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        if os.path.exists(destination_path):
            os.remove(destination_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save uploaded file: {str(exc)}",
        )

    if total_bytes == 0:
        if os.path.exists(destination_path):
            os.remove(destination_path)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty (0 bytes).",
        )

    if not is_valid_video_file(destination_path):
        if os.path.exists(destination_path):
            os.remove(destination_path)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid or readable video.",
        )

    logger.info(
        "Video upload successful: original='%s', filename='%s', size=%d bytes, path='%s'",
        original_filename, unique_filename, total_bytes, destination_path
    )
    return VideoUploadResponse(
        message="Video uploaded and validated successfully.",
        filename=unique_filename,
        video_path=destination_path,
        size_bytes=total_bytes,
    )


