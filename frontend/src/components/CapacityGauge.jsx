import React from 'react';
import { Users, AlertTriangle, AlertOctagon } from 'lucide-react';

export default function CapacityGauge({
  current = 0,
  capacity = 100,
  percentage,
  status = 'Normal',
  peak = 0,
  availableSpaces,
}) {
  const safeCapacity = capacity > 0 ? capacity : 100;
  const safeCurrent = Math.max(0, current);

  // Compute percentage if not explicitly supplied
  const calcPercentage = typeof percentage === 'number' && !isNaN(percentage)
    ? Math.max(0, percentage)
    : safeCapacity > 0 ? (safeCurrent / safeCapacity) * 100 : 0;

  // Compute available spaces if not explicitly supplied
  const safeAvailable = typeof availableSpaces === 'number' && !isNaN(availableSpaces)
    ? Math.max(0, availableSpaces)
    : Math.max(0, safeCapacity - safeCurrent);

  const isOverCapacity = safeCurrent > safeCapacity;
  const isAtCapacity = safeCurrent === safeCapacity || calcPercentage >= 100;
  const isWarning = calcPercentage >= 80 && calcPercentage < 100;

  // Clamped percentage for SVG stroke fill (0-100%)
  const ringFillPercentage = Math.min(100, Math.max(0, calcPercentage));

  // Gauge colors: muted sage and forest green for normal operation
  let statusBadgeStyle = 'bg-[#DCE8DD] text-[#37553A] border-[#AEC3B0]';
  let strokeColor = '#37553A'; // Dark forest green
  let linearGradient = 'from-[#6B9071] to-[#37553A]';

  if (isOverCapacity) {
    statusBadgeStyle = 'bg-[#FDEAE9] text-[#7B2422] border-[#F5B7B5] font-bold';
    strokeColor = '#C2413E';
    linearGradient = 'from-[#E57373] to-[#C2413E]';
  } else if (isAtCapacity) {
    statusBadgeStyle = 'bg-[#FDEAE9] text-[#7B2422] border-[#F5B7B5] font-bold';
    strokeColor = '#C2413E';
    linearGradient = 'from-[#F5B7B5] to-[#C2413E]';
  } else if (isWarning) {
    statusBadgeStyle = 'bg-[#FFF6E5] text-[#7A4900] border-[#F0CD8C] font-bold';
    strokeColor = '#B26A00';
    linearGradient = 'from-[#F0CD8C] to-[#B26A00]';
  }

  const excessCount = isOverCapacity ? safeCurrent - safeCapacity : 0;

  return (
    <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card relative overflow-hidden flex flex-col justify-between h-full">
      {/* Top Banner Alerts if threshold reached */}
      {isOverCapacity && (
        <div className="mb-4 p-3 rounded-xl bg-[#FDEAE9] border border-[#F5B7B5] flex items-center gap-2.5 text-xs text-[#7B2422] font-semibold">
          <AlertOctagon className="w-4 h-4 text-[#C2413E] flex-shrink-0" />
          <span>
            <strong>Over Capacity Limit:</strong> Venue holds {safeCurrent} attendees, exceeding limit of {safeCapacity} by {excessCount}.
          </span>
        </div>
      )}

      {isAtCapacity && !isOverCapacity && (
        <div className="mb-4 p-3 rounded-xl bg-[#FDEAE9] border border-[#F5B7B5] flex items-center gap-2.5 text-xs text-[#7B2422] font-semibold">
          <AlertOctagon className="w-4 h-4 text-[#C2413E] flex-shrink-0" />
          <span>
            <strong>Capacity Reached:</strong> Gathering has reached full venue limit ({safeCurrent}/{safeCapacity} seats). Restrict further admittance.
          </span>
        </div>
      )}

      {isWarning && (
        <div className="mb-4 p-3 rounded-xl bg-[#FFF6E5] border border-[#F0CD8C] flex items-center gap-2.5 text-xs text-[#7A4900] font-semibold">
          <AlertTriangle className="w-4 h-4 text-[#B26A00] flex-shrink-0" />
          <span>
            <strong>Approaching Capacity (&ge;80%):</strong> Hall is nearing seat threshold ({safeCurrent}/{safeCapacity}).
          </span>
        </div>
      )}

      {/* Header with Title and Status Badge */}
      <div className="flex items-center justify-between pb-3 border-b border-[#D4E0D5] mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#DCE8DD] text-[#37553A]">
            <Users className="w-5 h-5 text-[#37553A]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#263B2B]">Venue Capacity Monitor</h3>
            <p className="text-xs text-[#627466]">
              Configured limit: <strong className="text-[#263B2B]">{safeCapacity} attendees</strong>
            </p>
          </div>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full border shadow-2xs ${statusBadgeStyle}`}>
          {isOverCapacity ? 'Over Capacity' : isAtCapacity ? 'At Capacity' : isWarning ? 'Near Capacity' : status}
        </span>
      </div>

      {/* Main Content Area: Large Ring Gauge + Prominent Current Headcount */}
      <div className="flex flex-col sm:flex-row items-center gap-6 my-auto py-2">
        {/* Enriched Circular Gauge */}
        <div className="relative w-36 h-36 sm:w-40 sm:h-40 flex-shrink-0 flex items-center justify-center">
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
            <span className="text-3xl font-black text-[#263B2B] font-mono tracking-tight">
              {calcPercentage.toFixed(0)}%
            </span>
            <span className="text-[10px] text-[#627466] font-bold uppercase tracking-wider mt-0.5">
              Capacity
            </span>
          </div>
        </div>

        {/* Primary Headcount Display & Linear Bar */}
        <div className="flex-1 w-full space-y-4">
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#627466]">
                Current Headcount
              </span>
              <span className="text-xs font-mono text-[#627466]">
                {safeCurrent} / {safeCapacity} max
              </span>
            </div>
            {/* Primary & Most Prominent Display */}
            <div className="flex items-baseline gap-2">
              <span className="text-4xl sm:text-5xl font-black font-mono text-[#263B2B] tracking-tight">
                {safeCurrent}
              </span>
              <span className="text-sm font-semibold text-[#627466]">
                people in venue
              </span>
            </div>
          </div>

          {/* Linear Progress Bar */}
          <div>
            <div className="flex justify-between text-xs text-[#627466] mb-1 font-mono">
              <span>0</span>
              <span className="font-semibold text-[#263B2B]">{calcPercentage.toFixed(1)}% occupied</span>
              <span>{safeCapacity} max</span>
            </div>
            <div className="h-3 w-full bg-[#DCE8DD] rounded-full overflow-hidden border border-[#D4E0D5] p-0.5">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${linearGradient} transition-all duration-700 ease-out`}
                style={{ width: `${ringFillPercentage}%` }}
              />
            </div>
          </div>

          {/* Key Metrics Grid: Available Spaces & Peak */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="bg-[#FFFFFF] p-3 rounded-xl border border-[#D4E0D5] shadow-2xs">
              <p className="text-[11px] text-[#627466] font-semibold uppercase tracking-wide">Available Spaces</p>
              <p className={`text-lg font-bold font-mono mt-0.5 ${isOverCapacity ? 'text-[#7B2422]' : 'text-[#37553A]'}`}>
                {isOverCapacity ? `0 (+${excessCount} excess)` : `${safeAvailable} spaces`}
              </p>
              <p className="text-[10px] text-[#627466] mt-0.5">
                {isOverCapacity ? 'Exceeds venue capacity' : `${safeAvailable} of ${safeCapacity} seats open`}
              </p>
            </div>

            <div className="bg-[#FFFFFF] p-3 rounded-xl border border-[#D4E0D5] shadow-2xs">
              <p className="text-[11px] text-[#627466] font-semibold uppercase tracking-wide">Peak Attendance</p>
              <p className="text-lg font-bold text-[#263B2B] font-mono mt-0.5">
                {peak} <span className="text-xs font-normal text-[#627466]">attendees</span>
              </p>
              <p className="text-[10px] text-[#627466] mt-0.5">
                Highest session count
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
