import React, { useState } from 'react';
import {
  Settings as SettingsIcon,
  Server,
  Database,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  Info,
  RefreshCw,
  Users,
  Save,
  RotateCcw,
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import BackendAlertBanner from '../components/BackendAlertBanner';
import { resetCounters, API_BASE_URL } from '../api';

export default function Settings({
  health,
  stats,
  isConnected,
  isChecking,
  onRefresh,
  venueCapacity = 100,
  onUpdateVenueCapacity,
}) {
  // Configurable capacity form state
  const [capacityInput, setCapacityInput] = useState(venueCapacity.toString());
  const [capacityError, setCapacityError] = useState(null);
  const [capacitySaved, setCapacitySaved] = useState(false);

  // Counter reset state
  const [clearHistory, setClearHistory] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Save venue capacity
  const handleSaveCapacity = (e) => {
    e.preventDefault();
    setCapacityError(null);
    setCapacitySaved(false);

    const parsed = parseInt(capacityInput, 10);
    if (isNaN(parsed) || parsed <= 0 || !Number.isInteger(Number(capacityInput))) {
      setCapacityError('Please enter a valid positive whole number (e.g. 50, 100, 250).');
      return;
    }

    if (onUpdateVenueCapacity) {
      onUpdateVenueCapacity(parsed);
    }

    setCapacitySaved(true);
    setTimeout(() => setCapacitySaved(false), 4000);
  };

  // Reset capacity to default (100)
  const handleResetDefaultCapacity = () => {
    setCapacityInput('100');
    setCapacityError(null);
    if (onUpdateVenueCapacity) {
      onUpdateVenueCapacity(100);
    }
    setCapacitySaved(true);
    setTimeout(() => setCapacitySaved(false), 4000);
  };

  const handleConfirmReset = async () => {
    try {
      setIsResetting(true);
      const res = await resetCounters(clearHistory);
      setFeedback({
        type: 'success',
        message: res.message || 'Venue statistics and counters reset successfully.',
      });
      setIsModalOpen(false);
      if (onRefresh) onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to reset statistics.',
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      {!isConnected && (
        <BackendAlertBanner onRetry={onRefresh} isChecking={isChecking} />
      )}

      {/* Notification Toast */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-start justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-[#DCE8DD] border-[#AEC3B0] text-[#37553A]'
              : 'bg-[#FDEAE9] border-[#F5B7B5] text-[#7B2422]'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-[#37553A]" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-[#C2413E]" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs text-[#627466] hover:text-[#263B2B]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Venue Capacity Configuration */}
      <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#37553A] text-white">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#263B2B]">Expected Venue Capacity</h3>
              <p className="text-xs text-[#627466] mt-0.5">
                Set the maximum allowable attendee headcount for this meeting hall or gathering.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-[#DCE8DD] text-[#37553A] border border-[#AEC3B0]">
            Current: {venueCapacity} seats
          </span>
        </div>

        <form onSubmit={handleSaveCapacity} className="mt-4 space-y-4">
          <div className="max-w-md">
            <label className="block text-xs font-semibold text-[#263B2B] mb-1.5">
              Maximum Venue Threshold (Seats / Capacity)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                step="1"
                value={capacityInput}
                onChange={(e) => {
                  setCapacityInput(e.target.value);
                  setCapacityError(null);
                }}
                className="w-48 px-3.5 py-2.5 bg-[#FFFFFF] border border-[#D4E0D5] rounded-xl text-sm font-mono font-bold text-[#263B2B] focus:outline-none focus:border-[#37553A] transition"
                placeholder="100"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-[#37553A] hover:bg-[#2A422D] text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs"
              >
                <Save className="w-4 h-4" />
                <span>Save Capacity</span>
              </button>
              <button
                type="button"
                onClick={handleResetDefaultCapacity}
                title="Reset to 100 default"
                className="px-3 py-2.5 rounded-xl bg-[#DCE8DD] hover:bg-[#C8DBC9] text-[#263B2B] text-xs font-medium flex items-center gap-1 border border-[#D4E0D5] transition"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#37553A]" />
                <span>Reset to 100</span>
              </button>
            </div>
          </div>

          {/* Validation Error */}
          {capacityError && (
            <div className="p-3 rounded-xl bg-[#FDEAE9] border border-[#F5B7B5] text-[#7B2422] text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#C2413E] flex-shrink-0" />
              <span>{capacityError}</span>
            </div>
          )}

          {/* Save Confirmation Toast */}
          {capacitySaved && (
            <div className="p-3 rounded-xl bg-[#DCE8DD] border border-[#AEC3B0] text-[#37553A] text-xs flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-[#37553A] flex-shrink-0" />
              <span>
                Venue capacity set to <strong>{venueCapacity}</strong> seats. Dashboard gauges, warning thresholds (80%), and available space counts have been updated.
              </span>
            </div>
          )}

          {/* Storage & Backend Support Note */}
          <div className="p-4 rounded-xl bg-[#E8F0E8] border border-[#D4E0D5] text-xs text-[#627466] space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-[#263B2B]">
              <Info className="w-4 h-4 text-[#37553A]" />
              <span>Storage & Persistence Note</span>
            </div>
            <p>
              • <strong>Persistence:</strong> This setting is stored locally in your browser (<code className="font-mono text-[#263B2B]">localStorage</code>) and persists across browser refreshes and tab reloads.
            </p>
            <p>
              • <strong>Backend Behavior:</strong> As the FastAPI backend uses a default in-memory capacity without a dynamic modification endpoint, this setting is managed client-side.
            </p>
            <p>
              • <strong>Integrity:</strong> Updating this capacity <strong>never</strong> resets or clears live headcount, total entries, or event history records.
            </p>
          </div>
        </form>
      </div>

      {/* System Health & Architecture */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Backend Node Status */}
        <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <Server className="w-5 h-5 text-[#37553A]" />
              <h3 className="text-base font-bold text-[#263B2B]">Backend Infrastructure</h3>
            </div>
            <button
              onClick={onRefresh}
              disabled={isChecking}
              className="p-1.5 rounded-lg bg-[#DCE8DD] hover:bg-[#C8DBC9] text-[#37553A] border border-[#D4E0D5] transition disabled:opacity-50"
              title="Test API Health"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">API Endpoint:</span>
              <span className="text-[#263B2B] font-bold">{API_BASE_URL}</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">Status:</span>
              <span
                className={`font-semibold ${
                  isConnected ? 'text-[#37553A]' : 'text-[#C2413E]'
                }`}
              >
                {isConnected ? 'ONLINE (HEALTHY)' : 'OFFLINE'}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">App Name:</span>
              <span className="text-[#263B2B]">{health?.app || 'CrowdSense AI'}</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">Backend Version:</span>
              <span className="text-[#263B2B]">{health?.version || '1.0.0'}</span>
            </div>

            <div className="pt-2">
              <a
                href={`${API_BASE_URL}/docs`}
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-[#DCE8DD] hover:bg-[#C8DBC9] text-[#37553A] font-sans font-semibold border border-[#D4E0D5] transition"
              >
                <span>Open FastAPI Swagger Documentation</span>
                <ExternalLink className="w-3.5 h-3.5 text-[#37553A]" />
              </a>
            </div>
          </div>
        </div>

        {/* Venue & Computer Vision Specs */}
        <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
          <div className="flex items-center gap-2.5 mb-4">
            <Database className="w-5 h-5 text-[#37553A]" />
            <h3 className="text-base font-bold text-[#263B2B]">Gathering Specifications</h3>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">Configured Venue Limit:</span>
              <span className="text-[#263B2B] font-bold">{venueCapacity} seats</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">Vision Detector Model:</span>
              <span className="text-[#263B2B]">YOLOv8 Nano (yolov8n.pt)</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">Multi-Person Tracker:</span>
              <span className="text-[#263B2B]">ByteTrack</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">Event Audit Database:</span>
              <span className="text-[#263B2B]">SQLite (crowdsense.db)</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFFFF] border border-[#D4E0D5]">
              <span className="text-[#627466] font-sans">Video Processing Thread:</span>
              <span className="text-[#37553A] font-semibold">Async Background Worker</span>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone: Reset Counters */}
      <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#F5B7B5] shadow-forest-card">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-[#FDEAE9] text-[#7B2422] border border-[#F5B7B5]">
            <ShieldAlert className="w-6 h-6" />
          </div>

          <div className="flex-1">
            <h3 className="text-base font-bold text-[#263B2B]">Reset Meeting Headcounts & Log History</h3>
            <p className="text-xs text-[#627466] mt-1">
              Reset live in-memory metrics (Current Occupancy, Total Entries, Total Exits, Peak Headcount)
              back to 0. You can also optionally wipe the SQLite event log table.
            </p>

            <div className="mt-4 p-3 rounded-xl bg-[#E8F0E8] border border-[#D4E0D5] flex items-center gap-3">
              <input
                type="checkbox"
                id="clearHistoryCheckbox"
                checked={clearHistory}
                onChange={(e) => setClearHistory(e.target.checked)}
                className="w-4 h-4 rounded text-[#37553A] focus:ring-[#37553A] border-[#D4E0D5] cursor-pointer"
              />
              <label
                htmlFor="clearHistoryCheckbox"
                className="text-xs text-[#263B2B] font-medium cursor-pointer select-none"
              >
                Also delete all SQLite event records permanently (<code className="text-[#7B2422] font-mono">clear_history=true</code>)
              </label>
            </div>

            <div className="mt-5">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                disabled={!isConnected}
                className="px-5 py-2.5 rounded-xl bg-[#C2413E] hover:bg-[#A83230] text-white font-semibold text-xs transition flex items-center gap-2 shadow-2xs disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" />
                <span>Reset Statistics</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog Modal */}
      <ConfirmModal
        isOpen={isModalOpen}
        title="Reset Meeting Statistics?"
        message={
          clearHistory
            ? 'WARNING: This will reset all current occupancy, entries, and peak counters to 0, AND permanently delete all stored event history records in SQLite. This cannot be undone.'
            : 'Are you sure you want to reset current occupancy, entries, exits, and peak count to 0? Event history will be preserved in SQLite.'
        }
        confirmText={clearHistory ? 'Yes, Reset & Wipe Database' : 'Yes, Reset Counters'}
        cancelText="Cancel"
        isDanger={true}
        isLoading={isResetting}
        onConfirm={handleConfirmReset}
        onCancel={() => setIsModalOpen(false)}
      />
    </div>
  );
}
