"""
CrowdSense AI - Video Upload Test Suite
Tests video file upload, extension validation, size limits,
OpenCV verification, cleanup of invalid/oversized uploads,
and seamless integration with POST /video/process.
"""

import io
import os
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import database, main
from backend.main import app, counter


@pytest.fixture
def upload_test_env(tmp_path, monkeypatch):
    """
    Isolates the upload directory and database for upload tests so
    production data and project directories remain untouched.
    """
    test_db = str(tmp_path / "test_upload_crowdsense.db")
    test_upload_dir = str(tmp_path / "uploads" / "videos")
    os.makedirs(test_upload_dir, exist_ok=True)

    original_db = counter.db_path
    original_upload_dir = main.UPLOAD_DIR

    counter.db_path = test_db
    database.init_db(test_db)
    counter.reset(clear_db=True)

    monkeypatch.setattr(main, "UPLOAD_DIR", test_upload_dir)

    with TestClient(app) as client:
        yield client, test_upload_dir

    counter.reset(clear_db=True)
    counter.db_path = original_db
    counter.restore_state()


def _create_synthetic_video_bytes(num_frames: int = 5, width: int = 160, height: int = 120) -> bytes:
    """Helper to generate a real, readable MP4 video in memory."""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tf:
        temp_path = tf.name

    try:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(temp_path, fourcc, 10.0, (width, height))
        for _ in range(num_frames):
            frame = np.zeros((height, width, 3), dtype=np.uint8)
            out.write(frame)
        out.release()

        with open(temp_path, "rb") as f:
            data = f.read()
        return data
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def test_successful_video_upload_mocked_cv2(upload_test_env, monkeypatch):
    """
    Verify successful video upload:
    - Generates a unique server-side filename (never trusts user filename).
    - Preserves supported extension.
    - Accurately tracks size_bytes.
    - Leaves file intact on disk.
    """
    client, upload_dir = upload_test_env
    monkeypatch.setattr(main, "is_valid_video_file", lambda path: True)

    fake_video_data = b"FAKEMP4DATA_FOR_UPLOAD_TESTING"
    response = client.post(
        "/video/upload",
        files={"file": ("my_malicious_named..video.mp4", io.BytesIO(fake_video_data), "video/mp4")},
    )

    assert response.status_code == 200
    data = response.json()

    assert data["message"] == "Video uploaded and validated successfully."
    assert data["filename"].endswith(".mp4")
    assert data["filename"] != "my_malicious_named..video.mp4"
    assert data["size_bytes"] == len(fake_video_data)

    saved_path = data["video_path"]
    assert os.path.isabs(saved_path)
    assert os.path.exists(saved_path)
    assert os.path.dirname(saved_path) == os.path.abspath(upload_dir)


def test_upload_all_supported_extensions(upload_test_env, monkeypatch):
    """
    Verify that all required formats (.mp4, .mov, .avi, .mkv, .webm) are accepted.
    """
    client, _ = upload_test_env
    monkeypatch.setattr(main, "is_valid_video_file", lambda path: True)

    for ext in [".mp4", ".mov", ".avi", ".mkv", ".webm"]:
        res = client.post(
            "/video/upload",
            files={"file": (f"test_video{ext}", io.BytesIO(b"dummy_bytes"), "video/mp4")},
        )
        assert res.status_code == 200, f"Failed for extension {ext}: {res.text}"
        data = res.json()
        assert data["filename"].endswith(ext)
        assert os.path.exists(data["video_path"])


def test_upload_unsupported_extensions(upload_test_env):
    """
    Verify that non-video or unsupported extensions are rejected with HTTP 400
    and never written to the upload directory.
    """
    client, upload_dir = upload_test_env

    unsupported_files = [
        ("test.txt", b"plain text", "text/plain"),
        ("exploit.exe", b"MZexecutable", "application/octet-stream"),
        ("photo.jpg", b"image data", "image/jpeg"),
        ("document.pdf", b"pdf data", "application/pdf"),
        ("video_without_ext", b"no ext data", "application/octet-stream"),
    ]

    for fname, content, ctype in unsupported_files:
        res = client.post(
            "/video/upload",
            files={"file": (fname, io.BytesIO(content), ctype)},
        )
        assert res.status_code == 400, f"Expected 400 for {fname}, got {res.status_code}"
        assert "unsupported video format" in res.json()["detail"].lower()

    # Upload directory must remain completely empty
    assert len(os.listdir(upload_dir)) == 0


def test_upload_empty_file_rejected(upload_test_env):
    """
    Verify that 0-byte uploads are rejected with HTTP 400
    and any created empty file is cleaned up.
    """
    client, upload_dir = upload_test_env

    res = client.post(
        "/video/upload",
        files={"file": ("empty.mp4", io.BytesIO(b""), "video/mp4")},
    )

    assert res.status_code == 400
    assert "empty" in res.json()["detail"].lower()
    assert len(os.listdir(upload_dir)) == 0


def test_upload_oversized_file_rejected_and_cleaned_up(upload_test_env, monkeypatch):
    """
    Verify that files exceeding the maximum size limit are rejected with HTTP 413
    and partially written files are deleted immediately.
    """
    client, upload_dir = upload_test_env

    # Temporarily set max upload size to 256 bytes for testing
    monkeypatch.setattr(main, "MAX_UPLOAD_SIZE_BYTES", 256)
    monkeypatch.setattr(main, "CHUNK_SIZE", 64)

    oversized_data = b"A" * 512
    res = client.post(
        "/video/upload",
        files={"file": ("large_video.mp4", io.BytesIO(oversized_data), "video/mp4")},
    )

    assert res.status_code == 413
    assert "exceeds maximum allowed size" in res.json()["detail"].lower()
    # Partially written file must be cleaned up
    assert len(os.listdir(upload_dir)) == 0


def test_upload_invalid_video_contents_rejected_by_opencv(upload_test_env):
    """
    Verify that a file with a valid video extension (.mp4) but corrupt/non-video content
    fails OpenCV validation, returns HTTP 400, and is deleted from disk.
    """
    client, upload_dir = upload_test_env

    corrupted_data = b"THIS_IS_CORRUPTED_TEXT_NOT_A_REAL_VIDEO_HEADER"
    res = client.post(
        "/video/upload",
        files={"file": ("corrupt.mp4", io.BytesIO(corrupted_data), "video/mp4")},
    )

    assert res.status_code == 400
    assert "not a valid or readable video" in res.json()["detail"].lower()
    # Invalid file must not remain on disk
    assert len(os.listdir(upload_dir)) == 0


def test_uploaded_real_video_works_with_video_process_endpoint(upload_test_env):
    """
    End-to-end integration test:
    1. Upload a genuine synthetic video through POST /video/upload.
    2. Pass the returned video_path directly to existing POST /video/process.
    3. Verify that the video processing pipeline accepts the uploaded video path seamlessly.
    """
    client, _ = upload_test_env

    real_video_bytes = _create_synthetic_video_bytes(num_frames=6)
    upload_res = client.post(
        "/video/upload",
        files={"file": ("synthetic_clip.mp4", io.BytesIO(real_video_bytes), "video/mp4")},
    )

    assert upload_res.status_code == 200
    upload_data = upload_res.json()
    video_path = upload_data["video_path"]
    assert os.path.exists(video_path)

    # Pass the returned path to POST /video/process
    process_res = client.post(
        "/video/process",
        json={"video_path": video_path, "max_frames": 5},
    )
    assert process_res.status_code == 200
    process_data = process_res.json()
    assert process_data["status"] == "running"

    # Stop processing cleanly
    stop_res = client.post("/video/stop")
    assert stop_res.status_code == 200
