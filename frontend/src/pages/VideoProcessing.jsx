import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  FileVideo,
  Play,
  Square,
  AlertCircle,
  CheckCircle2,
  Sliders,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Clock,
  Gauge,
  Film,
  Crosshair,
  Download,
  Eye,
} from 'lucide-react';
import {
  uploadVideo,
  startVideoProcessing,
  getVideoStatus,
  stopVideoProcessing,
  getDebugVideoUrl,
} from '../api';
import BackendAlertBanner from '../components/BackendAlertBanner';

const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

export default function VideoProcessing({
  isConnected,
  isChecking,
  onRefreshStats,
  videoStatus,
  setVideoStatus,
}) {
  // File upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);

  // Video processing tuning options
  const [linePosition, setLinePosition] = useState(0.5);
  const [entryDirection, setEntryDirection] = useState('down');
  const [confThreshold, setConfThreshold] = useState(0.25);
  const [pointMode, setPointMode] = useState('center');
  const [saveDebugVideo, setSaveDebugVideo] = useState(false);
  const [modelName, setModelName] = useState('yolov8n.pt');
  const [maxFrames, setMaxFrames] = useState('');

  // Processing action states
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [processError, setProcessError] = useState(null);

  const fileInputRef = useRef(null);
  const isMountedRef = useRef(true);

  // Clean up object preview URL on unmount or file change
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [videoPreviewUrl]);

  // Poll video status periodically when job is running or stopping
  useEffect(() => {
    let interval = null;
    const isJobActive = videoStatus && (videoStatus.status === 'running' || videoStatus.status === 'stopping');

    if (isJobActive) {
      interval = setInterval(async () => {
        try {
          const status = await getVideoStatus();
          if (isMountedRef.current) {
            setVideoStatus(status);
            if (onRefreshStats) onRefreshStats();
          }
        } catch (err) {
          if (isMountedRef.current) {
            console.error('Failed to poll video status:', err);
          }
        }
      }, 1500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [videoStatus?.status, setVideoStatus, onRefreshStats]);

  // Client-side validation
  const validateFile = (file) => {
    if (!file) return 'No file selected.';

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Invalid format '${ext}'. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }

    if (file.size > MAX_SIZE_BYTES) {
      return `File exceeds maximum allowed limit of 500 MB (${(file.size / (1024 * 1024)).toFixed(1)} MB).`;
    }

    if (file.size === 0) {
      return 'File is empty (0 bytes).';
    }

    return null;
  };

  const handleFileSelect = (file) => {
    setUploadError(null);
    setProcessError(null);
    const error = validateFile(file);
    if (error) {
      setUploadError(error);
      setSelectedFile(null);
      setVideoPreviewUrl(null);
      return;
    }
    setSelectedFile(file);
    setUploadResult(null);

    // Create object URL for local video line preview
    try {
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
      const url = URL.createObjectURL(file);
      setVideoPreviewUrl(url);
    } catch (e) {
      console.warn('Could not create object URL for preview:', e);
    }

    // Auto-upload the selected file immediately
    handleUpload(file);
  };

  // Drag-and-drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // Execute chunked/streaming file upload
  const handleUpload = async (fileOverride = null) => {
    const file = fileOverride || selectedFile;
    if (!file) return null;

    try {
      setIsUploading(true);
      setUploadProgress(0);
      setUploadError(null);

      const response = await uploadVideo(file, (percent) => {
        if (isMountedRef.current) {
          setUploadProgress(percent);
        }
      });

      if (isMountedRef.current) {
        setUploadResult(response);
      }
      return response;
    } catch (err) {
      if (isMountedRef.current) {
        setUploadError(err.message || 'Failed to upload video to backend storage.');
      }
      return null;
    } finally {
      if (isMountedRef.current) {
        setIsUploading(false);
      }
    }
  };

  // Start processing
  const handleStartProcessing = async () => {
    setProcessError(null);

    let activeUpload = uploadResult;

    // If user has a selected file that hasn't completed upload yet, upload it now
    if (selectedFile && !activeUpload) {
      if (isUploading) {
        setProcessError('Upload is currently in progress. Please wait a moment...');
        return;
      }
      activeUpload = await handleUpload(selectedFile);
      if (!activeUpload) {
        setProcessError('Failed to upload selected video file. Please retry.');
        return;
      }
    }

    // Ensure we NEVER fall back to a previous video if a new file was chosen!
    const targetVideoPath = activeUpload?.video_path || (!selectedFile ? videoStatus?.video_path : null);

    if (!targetVideoPath) {
      setProcessError('Please select or upload a video before starting the tracking engine.');
      return;
    }

    try {
      setIsStarting(true);
      setProcessError(null);

      // Immediately reset run metrics in the UI so previous video run results don't linger
      if (isMountedRef.current) {
        setVideoStatus((prev) => {
          const startOcc = prev?.stats?.current_occupancy ?? 0;
          return {
            ...(prev || {}),
            status: 'running',
            video_path: targetVideoPath,
            total_frames: 0,
            processed_frames: 0,
            progress_percentage: 0,
            entries_detected: 0,
            exits_detected: 0,
            starting_occupancy: startOcc,
            run_occupancy: startOcc,
            current_fps: 0,
          };
        });
      }

      const params = {
        video_path: targetVideoPath,
        line_position: parseFloat(linePosition),
        entry_direction: entryDirection,
        conf_threshold: parseFloat(confThreshold),
        point_mode: pointMode,
        save_debug_video: saveDebugVideo,
        model_name: modelName,
        ...(maxFrames ? { max_frames: parseInt(maxFrames, 10) } : {}),
      };

      const result = await startVideoProcessing(params);
      if (isMountedRef.current) {
        setVideoStatus(result);
        if (onRefreshStats) onRefreshStats();
      }
    } catch (err) {
      if (isMountedRef.current) {
        setProcessError(err.message || 'Failed to start video processing');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStarting(false);
      }
    }
  };

  // Stop processing
  const handleStopProcessing = async () => {
    try {
      setIsStopping(true);
      const result = await stopVideoProcessing();
      if (isMountedRef.current) {
        setVideoStatus(result);
        if (onRefreshStats) onRefreshStats();
      }
    } catch (err) {
      if (isMountedRef.current) {
        setProcessError(err.message || 'Failed to stop video processing');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStopping(false);
      }
    }
  };

  const isRunning = videoStatus?.status === 'running';
  const isStoppingState = videoStatus?.status === 'stopping';

  return (
    <div className="space-y-6">
      {/* Backend Disconnection Banner */}
      {!isConnected && (
        <BackendAlertBanner
          isConnected={isConnected}
          isChecking={isChecking}
          onRetry={onRefreshStats}
        />
      )}

      {/* Main Grid: Upload (Left) & Tuning Controls (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Drag & Drop Ingestion (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
            <div className="flex items-center gap-2 mb-4">
              <FileVideo className="w-5 h-5 text-[#37553A]" />
              <h3 className="text-base font-bold text-[#263B2B]">Footage Ingestion</h3>
            </div>

            {/* Drag & Drop Surface */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-[#37553A] bg-[#DCE8DD]'
                  : 'border-[#6B9071] hover:border-[#37553A] bg-[#DCE8DD]/40 hover:bg-[#DCE8DD]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.mov,.avi,.mkv,.webm"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelect(e.target.files[0]);
                  }
                }}
              />

              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-[#F7FAF6] text-[#37553A] flex items-center justify-center border border-[#6B9071] shadow-2xs">
                <UploadCloud className="w-7 h-7" />
              </div>

              <p className="text-sm font-semibold text-[#263B2B]">
                Drag & drop meeting video file here, or{' '}
                <span className="text-[#37553A] underline underline-offset-2">browse files</span>
              </p>
              <p className="text-xs text-[#627466] mt-1.5">
                Formats: MP4, MOV, AVI, MKV, WEBM (verified via OpenCV on server)
              </p>
            </div>

            {/* Validation or Upload Error Banner */}
            {uploadError && (
              <div className="mt-4 p-3.5 rounded-xl bg-[#FDEAE9] border border-[#F5B7B5] text-[#7B2422] text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#C2413E]" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Selected File Card & Upload Trigger */}
            {selectedFile && !uploadResult && (
              <div className="mt-5 p-4 rounded-xl bg-[#E8F0E8] border border-[#D4E0D5] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#F7FAF6] border border-[#D4E0D5] text-[#37553A]">
                    <FileVideo className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#263B2B] break-all">{selectedFile.name}</p>
                    <p className="text-xs text-[#627466] font-mono mt-0.5">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={isUploading || !isConnected}
                  className="px-5 py-2.5 rounded-xl bg-[#37553A] hover:bg-[#2A422D] text-white font-semibold text-xs transition flex items-center justify-center gap-2 shadow-2xs disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading ({uploadProgress}%)</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-4 h-4" />
                      <span>Upload to Server</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Upload Progress Bar */}
            {isUploading && (
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-xs text-[#627466]">
                  <span>Transferring to backend storage...</span>
                  <span className="font-mono font-semibold text-[#37553A]">{uploadProgress}%</span>
                </div>
                <div className="h-2 w-full bg-[#DCE8DD] rounded-full overflow-hidden border border-[#D4E0D5]">
                  <div
                    className="h-full bg-gradient-to-r from-[#6B9071] to-[#37553A] transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Upload Success Feedback */}
            {uploadResult && (
              <div className="mt-5 p-4 rounded-xl bg-[#DCE8DD] border border-[#AEC3B0] text-xs">
                <div className="flex items-center gap-2 font-semibold text-[#37553A] mb-2">
                  <CheckCircle2 className="w-4 h-4 text-[#37553A]" />
                  <span>{uploadResult.message}</span>
                </div>
                <div className="space-y-1 text-[#263B2B] font-mono">
                  <p className="text-[#627466]">
                    Server Filename: <span className="text-[#263B2B]">{uploadResult.filename}</span>
                  </p>
                  <p className="text-[#627466]">
                    Destination: <span className="text-[#263B2B] break-all">{uploadResult.video_path}</span>
                  </p>
                  <p className="text-[#627466]">
                    Verified Size: <span className="text-[#263B2B]">{(uploadResult.size_bytes / (1024 * 1024)).toFixed(2)} MB</span>
                  </p>
                </div>
              </div>
            )}

            {/* Interactive Doorway Line Preview (When video is loaded) */}
            {videoPreviewUrl && (
              <div className="mt-5 p-3 rounded-xl bg-[#E8F0E8] border border-[#D4E0D5]">
                <div className="flex items-center justify-between text-xs font-semibold text-[#263B2B] mb-2">
                  <div className="flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-[#37553A]" />
                    <span>Doorway Alignment Preview</span>
                  </div>
                  <span className="text-[#37553A] font-mono font-bold text-[11px]">
                    Line at {(parseFloat(linePosition) * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="relative w-full rounded-lg overflow-hidden bg-black aspect-video max-h-48 flex items-center justify-center">
                  <video
                    src={videoPreviewUrl}
                    className="w-full h-full object-contain opacity-90"
                    muted
                    playsInline
                    onLoadedMetadata={(e) => {
                      e.target.currentTime = 0.5;
                    }}
                  />
                  {/* Overlay Virtual Line */}
                  <div
                    className="absolute left-0 right-0 border-t-2 border-dashed border-[#F4A261] z-10 pointer-events-none flex items-center justify-between px-2"
                    style={{ top: `${parseFloat(linePosition) * 100}%` }}
                  >
                    <span className="text-[10px] font-bold bg-[#263B2B]/90 text-white px-1.5 py-0.5 rounded shadow">
                      Doorway Threshold ({(parseFloat(linePosition) * 100).toFixed(0)}%)
                    </span>
                    <span className="text-[10px] font-bold bg-[#37553A]/90 text-white px-1.5 py-0.5 rounded shadow">
                      {entryDirection === 'down' ? '↓ Entry' : '↑ Entry'}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-[#627466] mt-1.5">
                  Adjust the line position slider on the right to align directly across the physical entrance threshold.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Processing Parameters (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
            <div className="flex items-center gap-2 mb-4">
              <Sliders className="w-5 h-5 text-[#37553A]" />
              <h3 className="text-base font-bold text-[#263B2B]">Detection Parameters</h3>
            </div>

            <div className="space-y-4">
              {/* Virtual Line Position */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-[#263B2B] font-medium">Virtual Doorway Line</span>
                  <span className="text-[#37553A] font-mono font-bold">{(parseFloat(linePosition) * 100).toFixed(0)}% height</span>
                </div>

                {/* Presets */}
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[
                    { id: 0.1, label: 'Top (0.1)' },
                    { id: 0.38, label: 'Door (0.38)' },
                    { id: 0.5, label: 'Center (0.5)' },
                    { id: 0.9, label: 'Floor (0.9)' },
                  ].map((pos) => (
                    <button
                      key={pos.id}
                      type="button"
                      onClick={() => setLinePosition(pos.id)}
                      className={`p-1.5 rounded-lg text-center border text-[11px] font-medium transition ${
                        Math.abs(parseFloat(linePosition) - pos.id) < 0.03
                          ? 'border-[#37553A] bg-[#37553A] text-white font-semibold'
                          : 'border-[#D4E0D5] bg-[#E8F0E8] text-[#263B2B] hover:bg-[#DCE8DD]'
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>

                {/* Continuous fine-grain slider */}
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.02"
                  value={linePosition}
                  onChange={(e) => setLinePosition(parseFloat(e.target.value))}
                  className="w-full accent-[#37553A] h-2 bg-[#DCE8DD] rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#627466] mt-1 font-medium font-mono">
                  <span>5% (Top)</span>
                  <span>50% (Center)</span>
                  <span>95% (Floor)</span>
                </div>
              </div>

              {/* Anchor Point Mode */}
              <div>
                <label className="block text-xs font-semibold text-[#263B2B] mb-1.5 flex items-center justify-between">
                  <span>Detection Anchor Point</span>
                  <span className="text-[10px] text-[#37553A] font-bold font-mono">
                    {pointMode === 'center' ? 'Torso / Centroid' : 'Feet / Ground'}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPointMode('center')}
                    className={`p-2 rounded-xl text-left border text-xs transition ${
                      pointMode === 'center'
                        ? 'border-[#37553A] bg-[#37553A] text-white font-semibold'
                        : 'border-[#D4E0D5] bg-[#E8F0E8] text-[#263B2B] hover:bg-[#DCE8DD]'
                    }`}
                  >
                    <div className="font-semibold">Torso / Center</div>
                    <div className="text-[10px] opacity-80">Recommended for doorway cameras</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPointMode('bottom_center')}
                    className={`p-2 rounded-xl text-left border text-xs transition ${
                      pointMode === 'bottom_center'
                        ? 'border-[#37553A] bg-[#37553A] text-white font-semibold'
                        : 'border-[#D4E0D5] bg-[#E8F0E8] text-[#263B2B] hover:bg-[#DCE8DD]'
                    }`}
                  >
                    <div className="font-semibold">Feet / Ground</div>
                    <div className="text-[10px] opacity-80">For high ceiling surveillance</div>
                  </button>
                </div>
              </div>

              {/* Entry Direction */}
              <div>
                <label className="block text-xs font-semibold text-[#263B2B] mb-1.5">
                  Direction for Entry
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'down', label: 'Downwards (↓)' },
                    { id: 'up', label: 'Upwards (↑)' },
                    { id: 'right', label: 'Rightwards (→)' },
                    { id: 'left', label: 'Leftwards (←)' },
                  ].map((dir) => (
                    <button
                      key={dir.id}
                      type="button"
                      onClick={() => setEntryDirection(dir.id)}
                      className={`p-2.5 rounded-xl text-left border text-xs transition ${
                        entryDirection === dir.id
                          ? 'border-[#37553A] bg-[#37553A] text-white font-semibold'
                          : 'border-[#D4E0D5] bg-[#E8F0E8] text-[#263B2B] hover:bg-[#DCE8DD]'
                      }`}
                    >
                      <div>{dir.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Confidence Threshold */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-[#263B2B] font-medium">YOLO Person Confidence</span>
                  <span className="text-[#37553A] font-mono font-bold">{confThreshold}</span>
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="0.80"
                  step="0.05"
                  value={confThreshold}
                  onChange={(e) => setConfThreshold(e.target.value)}
                  className="w-full accent-[#37553A] h-2 bg-[#DCE8DD] rounded-lg cursor-pointer"
                />
              </div>

              {/* Debug Annotated Video Option */}
              <div className="p-3 rounded-xl bg-[#E8F0E8] border border-[#D4E0D5]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveDebugVideo}
                    onChange={(e) => setSaveDebugVideo(e.target.checked)}
                    className="accent-[#37553A] w-4 h-4 rounded cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-[#263B2B]">Generate Visual Debug Video</span>
                    <p className="text-[10px] text-[#627466]">
                      Records bounding boxes, track IDs, threshold line, and crossing markers.
                    </p>
                  </div>
                </label>
              </div>

              {/* Frame Limit (Optional) */}
              <div>
                <label className="block text-xs font-semibold text-[#263B2B] mb-1.5">
                  Frame Limit (Optional)
                </label>
                <input
                  type="number"
                  placeholder="Leave empty for entire video"
                  value={maxFrames}
                  onChange={(e) => setMaxFrames(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#D4E0D5] rounded-xl text-xs text-[#263B2B] placeholder-[#627466] focus:outline-none focus:border-[#37553A] font-mono shadow-2xs"
                />
              </div>

              {/* Start Action Button */}
              <div className="pt-2">
                {processError && (
                  <div className="mb-3 p-3 rounded-xl bg-[#FDEAE9] border border-[#F5B7B5] text-[#7B2422] text-xs">
                    {processError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleStartProcessing}
                  disabled={
                    !isConnected ||
                    isRunning ||
                    isStoppingState ||
                    isStarting ||
                    (!uploadResult && !videoStatus?.video_path)
                  }
                  className="w-full py-3 rounded-xl bg-[#37553A] hover:bg-[#2A422D] text-white font-bold text-sm transition-all duration-150 flex items-center justify-center gap-2 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isStarting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Initiating Detection...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" />
                      <span>Start Video Processing</span>
                    </>
                  )}
                </button>
                {!uploadResult && !videoStatus?.video_path && (
                  <p className="text-[11px] text-[#627466] text-center mt-2">
                    Upload footage above to begin AI footfall counting.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Real-Time Processing Status Monitor */}
      <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#DCE8DD] text-[#37553A]">
              <Film className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-bold text-[#263B2B]">Execution Status & Progress</h3>
                {videoStatus && (
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-bold uppercase border ${
                      isRunning
                        ? 'bg-[#DCE8DD] text-[#37553A] border-[#AEC3B0] animate-pulse'
                        : isStoppingState
                        ? 'bg-[#FFF6E5] text-[#7A4900] border-[#F0CD8C]'
                        : videoStatus.status === 'completed'
                        ? 'bg-[#DCE8DD] text-[#37553A] border-[#AEC3B0]'
                        : videoStatus.status === 'failed'
                        ? 'bg-[#FDEAE9] text-[#7B2422] border-[#F5B7B5]'
                        : 'bg-[#DCE8DD] text-[#627466] border-[#D4E0D5]'
                    }`}
                  >
                    {videoStatus.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#627466] mt-0.5">
                YOLOv8 person detector + ByteTrack multi-object tracking engine
              </p>
              {(videoStatus?.run_id || videoStatus?.video_path) && (
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                  {videoStatus?.run_id && (
                    <span className="px-2 py-0.5 rounded-md font-mono font-semibold bg-[#FFFFFF] text-[#37553A] border border-[#D4E0D5]">
                      Run #{videoStatus.run_id}
                    </span>
                  )}
                  {videoStatus?.video_path && (
                    <span className="text-[#627466] font-mono truncate max-w-[280px]" title={videoStatus.video_path}>
                      Target: {videoStatus.video_path.split(/[\\/]/).pop()}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Download Debug Video Button */}
            {videoStatus?.debug_video_path && (
              <a
                href={getDebugVideoUrl(videoStatus.debug_video_path)}
                download
                className="px-4 py-2 rounded-xl bg-[#37553A] hover:bg-[#2A422D] text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Debug Video</span>
              </a>
            )}

            {/* Stop Button */}
            {isRunning && (
              <button
                onClick={handleStopProcessing}
                disabled={isStopping || isStoppingState}
                className="px-4 py-2 rounded-xl bg-[#FDEAE9] hover:bg-[#F9D4D2] text-[#7B2422] border border-[#F5B7B5] text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
              >
                <Square className="w-3.5 h-3.5 fill-[#7B2422]" />
                <span>{isStopping || isStoppingState ? 'Stopping...' : 'Stop Processing'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Progress Display */}
        {videoStatus ? (
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-xs mb-2 font-mono">
                <span className="text-[#627466] font-medium">
                  Frames: {videoStatus.processed_frames} / {videoStatus.total_frames || 'Calculating'}
                </span>
                <span className="text-[#37553A] font-bold">
                  {videoStatus.progress_percentage.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 w-full bg-[#DCE8DD] rounded-full overflow-hidden border border-[#D4E0D5] p-0.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#6B9071] to-[#37553A] transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, videoStatus.progress_percentage))}%` }}
                />
              </div>
            </div>

            {/* Run Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-[#FFFFFF] p-3.5 rounded-xl border border-[#D4E0D5]">
                <div className="flex items-center gap-1.5 text-[#627466] text-xs">
                  <Gauge className="w-3.5 h-3.5 text-[#6B9071]" />
                  <span>Processing Speed</span>
                </div>
                <p className="text-lg font-bold text-[#263B2B] font-mono mt-1">
                  {videoStatus.current_fps ? `${videoStatus.current_fps} FPS` : '--'}
                </p>
              </div>

              <div className="bg-[#FFFFFF] p-3.5 rounded-xl border border-[#D4E0D5]">
                <div className="flex items-center gap-1.5 text-[#627466] text-xs">
                  <ArrowDown className="w-3.5 h-3.5 text-[#37553A]" />
                  <span>Run Entries</span>
                </div>
                <p className="text-lg font-bold text-[#37553A] font-mono mt-1">
                  +{videoStatus.entries_detected ?? 0}
                </p>
              </div>

              <div className="bg-[#FFFFFF] p-3.5 rounded-xl border border-[#D4E0D5]">
                <div className="flex items-center gap-1.5 text-[#627466] text-xs">
                  <ArrowUp className="w-3.5 h-3.5 text-[#6B9071]" />
                  <span>Run Exits</span>
                </div>
                <p className="text-lg font-bold text-[#6B9071] font-mono mt-1">
                  +{videoStatus.exits_detected ?? 0}
                </p>
              </div>

              <div className="bg-[#FFFFFF] p-3.5 rounded-xl border border-[#D4E0D5]">
                <div className="flex items-center gap-1.5 text-[#627466] text-xs">
                  <Clock className="w-3.5 h-3.5 text-[#37553A]" />
                  <span>Live Headcount</span>
                </div>
                <p className="text-lg font-bold text-[#263B2B] font-mono mt-1">
                  {typeof videoStatus.run_occupancy === 'number'
                    ? videoStatus.run_occupancy
                    : videoStatus.stats ? videoStatus.stats.current_occupancy : '--'}
                </p>
                <p className="text-[10px] text-[#627466] mt-0.5 font-mono">
                  Starting: {videoStatus.starting_occupancy ?? (videoStatus.stats?.current_occupancy ?? 0)}
                </p>
              </div>
            </div>

            {/* Error Message if failed */}
            {videoStatus.error_message && (
              <div className="p-3.5 rounded-xl bg-[#FDEAE9] border border-[#F5B7B5] text-[#7B2422] text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#C2413E] flex-shrink-0" />
                <span>Detection Error: {videoStatus.error_message}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-[#627466] text-sm">
            Status information will appear here once connected to the backend.
          </div>
        )}
      </div>
    </div>
  );
}