import React from 'react';
import { AlertTriangle, Terminal, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../api';

export default function BackendAlertBanner({ onRetry, isChecking }) {
  return (
    <div className="mb-6 p-4 rounded-xl border border-[#F5B7B5] bg-[#FDEAE9] text-[#7B2422] shadow-2xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[#F9D4D2] text-[#7B2422] mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-[#641A19]">Backend Server Disconnected</h4>
            <p className="text-xs text-[#7B2422] mt-0.5">
              Cannot connect to FastAPI service at <code className="text-[#641A19] font-mono font-semibold">{API_BASE_URL}</code>.
              Live headcount data and automated video tracking will resume once the backend server is running.
            </p>
            <div className="mt-2.5 flex items-center gap-2 text-xs text-[#263B2B] font-mono bg-[#F7FAF6] px-3 py-1.5 rounded-lg border border-[#F5B7B5] w-fit shadow-2xs">
              <Terminal className="w-3.5 h-3.5 text-[#37553A]" />
              <span>python3 -m uvicorn backend.main:app --reload --port 8000</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end md:self-center">
          <button
            onClick={onRetry}
            disabled={isChecking}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#37553A] hover:bg-[#2A422D] text-white shadow-2xs transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            <span>Retry Connection</span>
          </button>
        </div>
      </div>
    </div>
  );
}
