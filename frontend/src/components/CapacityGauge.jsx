import React from 'react';
import { Users, AlertTriangle, AlertOctagon } from 'lucide-react';

export default function CapacityGauge({
  current = 0,
  capacity = 100,
  percentage = 0,
  status = 'Normal',
  peak = 0,
}) {
  const safeCapacity = capacity > 0 ? capacity : 100;
  const isOverCapacity = current > safeCapacity;
  const isAtCapacity = percentage >= 100;
  const isWarning = percentage >= 80 && percentage < 100;

  // Clamped percentage for SVG stroke fill, but display full actual percentage
  const ringFillPercentage = Math.min(100, Math.max(0, percentage));

  // Gauge colors: muted sage and forest green for normal operation
  let statusBadgeStyle = 'bg-[#DCE8DD] text-[#37553A] border-[#AEC3B0]';
  let strokeColor = '#37553A'; // Dark forest green
  let linearGradient = 'from-[#6B9071] to-[#37553A]';

  if (isAtCapacity || isOverCapacity) {
    statusBadgeStyle = 'bg-[#FDEAE9] text-[#7B2422] border-[#F5B7B5] font-bold';
    strokeColor = '#C2413E'; // Restrained red
    linearGradient = 'from-[#E57373] to-[#C2413E]';
  } else if (isWarning) {
    statusBadgeStyle = 'bg-[#FFF6E5] text-[#7A4900] border-[#F0CD8C] font-bold';
    strokeColor = '#B26A00'; // Soft amber
    linearGradient = 'from-[#F0CD8C] to-[#B26A00]';
  }

  const availableSlots = Math.max(0, safeCapacity - current);
  const excessCount = isOverCapacity ? current - safeCapacity : 0;

  return (
    <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card relative overflow-hidden">
      {/* Alert Header if threshold reached */}
      {isAtCapacity && (
        <div className="mb-4 p-3 rounded-xl bg-[#FDEAE9] border border-[#F5B7B5] flex items-center gap-2.5 text-xs text-[#7B2422] font-semibold">
          <AlertOctagon className="w-4 h-4 text-[#C2413E] flex-shrink-0" />
          <span>
            <strong>Capacity Reached:</strong> Gathering has reached or exceeded venue limit ({current}/{safeCapacity}). Restrict further admittance.
          </span>
        </div>
      )}

      {isWarning && (
        <div className="mb-4 p-3 rounded-xl bg-[#FFF6E5] border border-[#F0CD8C] flex items-center gap-2.5 text-xs text-[#7A4900] font-semibold">
          <AlertTriangle className="w-4 h-4 text-[#B26A00] flex-shrink-0" />
          <span>
            <strong>Approaching Capacity (≥80%):</strong> Hall is nearing seat threshold ({current}/{safeCapacity}). Prepare crowd control.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-[#263B2B]">Venue Capacity Monitor</h3>
          <p className="text-xs text-[#627466] mt-0.5">
            Configured limit: <strong className="text-[#263B2B]">{safeCapacity} attendees</strong>
          </p>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full border ${statusBadgeStyle}`}>
          {isOverCapacity ? 'Over Capacity' : isAtCapacity ? 'At Capacity' : isWarning ? 'Near Capacity' : status}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6 my-2">
        {/* Progress ring or circular gauge */}
        <div className="relative w-32 h-32 flex-shrink-0 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
            {/* Background Circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              stroke="#DCE8DD"
              strokeWidth="9"
              fill="transparent"
            />
            {/* Progress Circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              stroke={strokeColor}
              strokeWidth="9"
              strokeDasharray={2 * Math.PI * 40}
              strokeDashoffset={2 * Math.PI * 40 * (1 - ringFillPercentage / 100)}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
              fill="transparent"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-black text-[#263B2B] font-mono tracking-tight">
              {percentage.toFixed(0)}%
            </span>
            <span className="text-[10px] text-[#627466] font-bold uppercase tracking-wider">
              Filled
            </span>
          </div>
        </div>

        {/* Capacity Details */}
        <div className="flex-1 w-full space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1.5 font-medium">
              <span className="text-[#627466]">Current Live Headcount</span>
              <span className="text-[#263B2B] font-mono font-bold">
                {current} <span className="text-[#627466] font-normal">/ {safeCapacity} max</span>
              </span>
            </div>
            {/* Linear Progress Bar */}
            <div className="h-2.5 w-full bg-[#DCE8DD] rounded-full overflow-hidden border border-[#D4E0D5] p-0.5">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${linearGradient} transition-all duration-700 ease-out`}
                style={{ width: `${ringFillPercentage}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#D4E0D5]">
            <div className="bg-[#FFFFFF] p-2.5 rounded-xl border border-[#D4E0D5] shadow-2xs">
              <p className="text-[11px] text-[#627466] font-medium">Available Spaces</p>
              <p className={`text-base font-bold font-mono mt-0.5 ${isOverCapacity ? 'text-[#7B2422]' : 'text-[#37553A]'}`}>
                {isOverCapacity ? `0 (+${excessCount} excess)` : `${availableSlots} seats left`}
              </p>
            </div>
            <div className="bg-[#FFFFFF] p-2.5 rounded-xl border border-[#D4E0D5] shadow-2xs">
              <p className="text-[11px] text-[#627466] font-medium">Peak Recorded</p>
              <p className="text-base font-bold text-[#263B2B] font-mono mt-0.5">{peak} attendees</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
