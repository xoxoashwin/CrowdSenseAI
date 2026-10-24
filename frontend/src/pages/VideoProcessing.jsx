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
} from 'lucide-react';
import {
  uploadVideo,
  startVideoProcessing,
  getVideoStatus,
  stopVideoProcessing,
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
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);

  // Video processing tuning options
  const [linePosition, setLinePosition] = useState(0.5);
  const [entryDirection, setEntryDirection] = useState('down');
  const [confThreshold, setConfThreshold] = useState(0.25);
  const [modelName, setModelName] = useState('yolov8n.pt');
  const [maxFrames, setMaxFrames] = useState('');

  // Processing action states
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [processError, setProcessError] = useState(null);

  const fileInputRef = useRef(null);

  // Poll video status periodically when job is running or stopping
  useEffect(() => {
    let interval = null;
    const isJobActive = videoStatus && (videoStatus.status === 'running' || videoStatus.status === 'stopping');

    if (isJobActive) {
      interval = setInterval(async () => {
        try {
          const status = await getVideoStatus();
          setVideoStatus(status);
          if (onRefreshStats) onRefreshStats();
        } catch (err) {
          console.error('Failed to poll video status:', err);
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
    setUploadResult(null);
    setProcessError(null);

    const error = validateFile(file);
    if (error) {
      setUploadError(error);
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

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

  // Perform upload
  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setIsUploading(true);
      setUploadError(null);
      setUploadProgress(0);

      const result = await uploadVideo(selectedFile, (percent) => {
        setUploadProgress(percent);
      });

      setUploadResult(result);
    } catch (err) {
      setUploadError(err.message || 'Failed to upload video');
    } finally {
      setIsUploading(false);
    }
  };

  // Start processing (only when explicitly triggered by user)
  const handleStartProcessing = async () => {
    const targetVideoPath = uploadResult?.video_path || videoStatus?.video_path;

    if (!targetVideoPath) {
      setProcessError('Please upload a video first.');
      return;
    }

    try {
      setIsStarting(true);
      setProcessError(null);

      const params = {
        video_path: targetVideoPath,
        line_position: parseFloat(linePosition),
        entry_direction: entryDirection,
        conf_threshold: parseFloat(confThreshold),
        model_name: modelName,
        ...(maxFrames ? { max_frames: parseInt(maxFrames, 10) } : {}),
      };

      const result = await startVideoProcessing(params);
      setVideoStatus(result);
      if (onRefreshStats) onRefreshStats();
    } catch (err) {
      setProcessError(err.message || 'Failed to start video processing');
    } finally {
      setIsStarting(false);
    }
  };

  // Stop processing
  const handleStopProcessing = async () => {
    try {
      setIsStopping(true);
      const result = await stopVideoProcessing();
      setVideoStatus(result);
      if (onRefreshStats) onRefreshStats();
    } catch (err) {
      setProcessError(err.message || 'Failed to stop video processing');
    } finally {
      setIsStopping(false);
    }
  };

  const isRunning = videoStatus?.status === 'running';
  const isStoppingState = videoStatus?.status === 'stopping';

  return (
    <div className="space-y-6">
      {!isConnected && (
        <BackendAlertBanner onRetry={onRefreshStats} isChecking={isChecking} />
      )}

      {/* Grid: Upload & Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Upload Section (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-[#263B2B]">Meeting Footage Ingestion</h3>
                <p className="text-xs text-[#627466] mt-0.5">
                  Upload hall or doorway video footage for AI person tracking and automated counts.
                </p>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#DCE8DD] text-[#37553A] font-bold border border-[#AEC3B0]">
                Max 500 MB
              </span>
            </div>

            {/* Drop Zone with Light Sage Background & Muted Green Border */}
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

            {/* Selected File Card & Dark Forest Green Upload Trigger */}
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

            {/* Upload Progress Bar in Forest Green */}
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
                  <span className="text-[#37553A] font-mono font-bold">{(linePosition * 100).toFixed(0)}% height</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  value={linePosition}
                  onChange={(e) => setLinePosition(e.target.value)}
                  className="w-full accent-[#37553A] h-2 bg-[#DCE8DD] rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#627466] mt-1 font-medium">
                  <span>Top Gate (0.1)</span>
                  <span>Center (0.5)</span>
                  <span>Bottom Gate (0.9)</span>
                </div>
              </div>

              {/* Entry Direction */}
              <div>
                <label className="block text-xs font-semibold text-[#263B2B] mb-1.5">
                  Direction for Entry
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'down', label: 'Downwards (↓)', desc: 'Moving down' },
                    { id: 'up', label: 'Upwards (↑)', desc: 'Moving up' },
                    { id: 'right', label: 'Rightwards (→)', desc: 'Moving right' },
                    { id: 'left', label: 'Leftwards (←)', desc: 'Moving left' },
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

              {/* Dark Forest Green Start Processing Action */}
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
            </div>
          </div>

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
                  {videoStatus.stats ? videoStatus.stats.current_occupancy : '--'}
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
