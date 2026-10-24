/**
 * CrowdSense AI - API Client
 * Connects frontend to the FastAPI backend running at http://127.0.0.1:8000
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

/**
 * Custom Error class that contains status code and detail from the backend.
 */
export class ApiError extends Error {
  constructor(message, status, detail = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Generic request helper with JSON parsing and standardized error handling.
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const defaultHeaders = {
    'Accept': 'application/json',
  };

  // Only set Content-Type to json if body is not FormData
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const detail = typeof data === 'object' && data?.detail ? data.detail : data;
      throw new ApiError(
        typeof detail === 'string' ? detail : `Request failed with status ${response.status}`,
        response.status,
        detail
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network / offline error
    throw new ApiError(
      'Unable to connect to the backend server. Please verify the backend is running at ' + API_BASE_URL,
      0,
      error.message
    );
  }
}

/**
 * Health check endpoint: GET /health
 */
export async function getHealth() {
  return request('/health', { method: 'GET' });
}

/**
 * Get current occupancy and venue statistics: GET /stats
 */
export async function getStats() {
  return request('/stats', { method: 'GET' });
}

/**
 * Get event history log: GET /events?limit=50
 */
export async function getEvents(limit = 50) {
  return request(`/events?limit=${encodeURIComponent(limit)}`, { method: 'GET' });
}

/**
 * Record an entry event manually: POST /events/entry
 */
export async function recordEntry(data = { count: 1, note: null }) {
  return request('/events/entry', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Record an exit event manually: POST /events/exit
 */
export async function recordExit(data = { count: 1, note: null }) {
  return request('/events/exit', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Reset counters and optionally clear database history: POST /reset?clear_history=false
 */
export async function resetCounters(clearHistory = false) {
  return request(`/reset?clear_history=${Boolean(clearHistory)}`, {
    method: 'POST',
  });
}

/**
 * Upload a video file with progress tracking: POST /video/upload
 * Uses XMLHttpRequest to report precise upload progress percentage.
 */
export function uploadVideo(file, onProgress = null) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}/video/upload`;
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.responseType = 'json';

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent, event.loaded, event.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        const errorDetail = xhr.response?.detail || `Upload failed with status ${xhr.status}`;
        reject(new ApiError(errorDetail, xhr.status, xhr.response));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error during video upload. Check backend connection.', 0));
    };

    xhr.send(formData);
  });
}

/**
 * Start video processing job: POST /video/process
 */
export async function startVideoProcessing(params) {
  const payload = {
    video_path: params.video_path,
    line_position: params.line_position ?? 0.5,
    entry_direction: params.entry_direction ?? 'down',
    conf_threshold: params.conf_threshold ?? 0.25,
    model_name: params.model_name ?? 'yolov8n.pt',
    ...(params.line_coords ? { line_coords: params.line_coords } : {}),
    ...(params.max_frames ? { max_frames: params.max_frames } : {}),
  };

  return request('/video/process', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Get video processing status: GET /video/status
 */
export async function getVideoStatus() {
  return request('/video/status', { method: 'GET' });
}

/**
 * Request ongoing video processing to stop: POST /video/stop
 */
export async function stopVideoProcessing() {
  return request('/video/stop', { method: 'POST' });
}
