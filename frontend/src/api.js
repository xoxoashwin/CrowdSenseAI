/**
 * CrowdSense AI - API Client
 * Connects frontend to the FastAPI backend running at http://127.0.0.1:8000
 * Hardened with timeout handling, connection drop resilience, and error classification.
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

/**
 * Custom Error class that contains status code, classification flags, and backend detail.
 */
export class ApiError extends Error {
  constructor(message, status = 0, detail = null, isTimeout = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.isTimeout = Boolean(isTimeout);
    this.isNetworkError = status === 0 && !isTimeout;
    this.isClientError = status >= 400 && status < 500;
    this.isServerError = status >= 500;
  }
}

/**
 * Generic request helper with timeout control, JSON parsing, and standardized error normalization.
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

  // Timeout handling via AbortController (default 10 seconds for REST queries)
  const timeoutMs = options.timeout !== undefined ? options.timeout : 10000;
  const controller = new AbortController();
  let timeoutId = null;
  let didTimeout = false;

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  // Chain external abort signal if provided
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const { timeout: _unusedTimeout, signal: _unusedSignal, ...restOptions } = options;

  const config = {
    ...restOptions,
    signal: controller.signal,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);
    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = await response.text().catch(() => '');
      }
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      let detail = data;

      if (data && typeof data === 'object') {
        if (data.detail) {
          detail = data.detail;
          message = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
        } else if (data.message) {
          message = data.message;
        }
      } else if (typeof data === 'string' && data.trim()) {
        message = data.trim();
      }

      throw new ApiError(message, response.status, detail);
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (didTimeout || error.name === 'AbortError') {
      if (didTimeout) {
        throw new ApiError(
          `Request to ${endpoint} timed out after ${timeoutMs}ms. Backend server may be busy or restarting.`,
          0,
          error.message,
          true
        );
      }
      throw new ApiError('Request was aborted by the application.', 0, error.message, false);
    }

    // Network / offline error
    throw new ApiError(
      'Unable to connect to the backend server. Please verify the backend is running at ' + API_BASE_URL,
      0,
      error.message
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Health check endpoint: GET /health
 */
export async function getHealth(options = {}) {
  return request('/health', { method: 'GET', ...options });
}

/**
 * Get current occupancy and venue statistics: GET /stats
 */
export async function getStats(options = {}) {
  return request('/stats', { method: 'GET', ...options });
}

/**
 * Get event history log: GET /events?limit=50
 */
export async function getEvents(limit = 50, options = {}) {
  return request(`/events?limit=${encodeURIComponent(limit)}`, { method: 'GET', ...options });
}

/**
 * Record an entry event manually: POST /events/entry
 */
export async function recordEntry(data = { count: 1, note: null }, options = {}) {
  return request('/events/entry', {
    method: 'POST',
    body: JSON.stringify(data),
    ...options,
  });
}

/**
 * Record an exit event manually: POST /events/exit
 */
export async function recordExit(data = { count: 1, note: null }, options = {}) {
  return request('/events/exit', {
    method: 'POST',
    body: JSON.stringify(data),
    ...options,
  });
}

/**
 * Reset counters and optionally clear database history: POST /reset?clear_history=false
 */
export async function resetCounters(clearHistory = false, options = {}) {
  return request(`/reset?clear_history=${Boolean(clearHistory)}`, {
    method: 'POST',
    ...options,
  });
}

/**
 * Upload a video file with progress tracking: POST /video/upload
 * Uses XMLHttpRequest to report precise upload progress percentage.
 * Hardened with explicit 3-minute timeout and network error guards.
 */
export function uploadVideo(file, onProgress = null, options = {}) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}/video/upload`;
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    const timeoutMs = options.timeout !== undefined ? options.timeout : 180000; // 3 minutes default

    xhr.open('POST', url, true);
    xhr.responseType = 'json';
    xhr.timeout = timeoutMs;

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
        const resp = xhr.response;
        const errorDetail = resp?.detail || resp?.message || `Upload failed with status ${xhr.status}`;
        reject(
          new ApiError(
            typeof errorDetail === 'string' ? errorDetail : 'Upload failed',
            xhr.status,
            resp
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error during video upload. Check backend connection.', 0));
    };

    xhr.ontimeout = () => {
      reject(
        new ApiError(
          `Video upload timed out after ${timeoutMs}ms. Backend storage may be slow or unresponsive.`,
          0,
          null,
          true
        )
      );
    };

    xhr.onabort = () => {
      reject(new ApiError('Video upload was cancelled.', 0, null, false));
    };

    xhr.send(formData);
  });
}

/**
 * Start video processing job: POST /video/process
 */
export async function startVideoProcessing(params, options = {}) {
  const payload = {
    video_path: params.video_path,
    line_position: params.line_position ?? 0.5,
    entry_direction: params.entry_direction ?? 'down',
    conf_threshold: params.conf_threshold ?? 0.25,
    model_name: params.model_name ?? 'yolov8n.pt',
    point_mode: params.point_mode ?? 'center',
    save_debug_video: Boolean(params.save_debug_video),
    ...(params.line_coords ? { line_coords: params.line_coords } : {}),
    ...(params.max_frames ? { max_frames: params.max_frames } : {}),
  };

  return request('/video/process', {
    method: 'POST',
    body: JSON.stringify(payload),
    // Background video start might take a moment to initialize YOLO model
    timeout: options.timeout ?? 30000,
    ...options,
  });
}

/**
 * Get video processing status: GET /video/status
 */
export async function getVideoStatus(options = {}) {
  return request('/video/status', { method: 'GET', timeout: options.timeout ?? 8000, ...options });
}

/**
 * Request ongoing video processing to stop: POST /video/stop
 */
export async function stopVideoProcessing(options = {}) {
  return request('/video/stop', { method: 'POST', timeout: options.timeout ?? 10000, ...options });
}

/**
 * Helper to construct the download URL for the annotated debug video
 */
export function getDebugVideoUrl(filePath) {
  return `${API_BASE_URL}/video/debug/download?path=${encodeURIComponent(filePath)}`;
}
