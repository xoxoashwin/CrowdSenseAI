import React from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

export default function BackendStatusBadge({ isConnected, isChecking, onRefresh }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
          isConnected
            ? 'bg-[#DCE8DD] text-[#37553A] border-[#6B9071]/40 shadow-2xs'
            : 'bg-[#FDEAE9] text-[#7B2422] border-[#F5B7B5] shadow-2xs'
        }`}
      >
        <span className="relative flex h-2 w-2">
          {isConnected && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6B9071] opacity-75"></span>
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isConnected ? 'bg-[#37553A]' : 'bg-[#C2413E]'
            }`}
          ></span>
        </span>
        <span className="flex items-center gap-1.5">
          {isConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-[#37553A]" />
              <span>Backend Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-[#C2413E]" />
              <span>Backend Disconnected</span>
            </>
          )}
        </span>
      </div>

      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={isChecking}
          title="Refresh backend status"
          className="p-1.5 rounded-lg bg-[#F7FAF6] hover:bg-[#DCE8DD] text-[#37553A] border border-[#D4E0D5] shadow-2xs transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-[#37553A]' : ''}`} />
        </button>
      )}
    </div>
  );
}
