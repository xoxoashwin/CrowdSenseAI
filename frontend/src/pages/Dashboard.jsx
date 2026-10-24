import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  UserMinus,
  TrendingUp,
  Video,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Sparkles,
  AlertTriangle,
  AlertOctagon,
} from 'lucide-react';
import StatCard from '../components/StatCard';
import CapacityGauge from '../components/CapacityGauge';
import BackendAlertBanner from '../components/BackendAlertBanner';
import { recordEntry, recordExit } from '../api';

export default function Dashboard({
  stats,
  events,
  isConnected,
  isChecking,
  onRefresh,
  videoStatus,
  onNavigate,
  venueCapacity = 100,
}) {
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  const handleQuickEntry = async () => {
    try {
      setIsActionLoading(true);
      const res = await recordEntry({ count: 1, note: 'Meeting Hall Manual Entry' });
      setActionMessage({ text: res.message, type: 'success' });
      if (onRefresh) onRefresh();
    } catch (err) {
      setActionMessage({ text: err.message, type: 'error' });
    } finally {
      setIsActionLoading(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  const handleQuickExit = async () => {
    try {
      setIsActionLoading(true);
      const res = await recordExit({ count: 1, note: 'Meeting Hall Manual Exit' });
      setActionMessage({ text: res.message, type: 'success' });
      if (onRefresh) onRefresh();
    } catch (err) {
      setActionMessage({ text: err.message, type: 'error' });
    } finally {
      setIsActionLoading(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  const currentOccupancy = stats?.current_occupancy ?? 0;
  const safeCapacity = venueCapacity > 0 ? venueCapacity : 100;
  const occupancyPercentage = safeCapacity > 0 ? (currentOccupancy / safeCapacity) * 100 : 0;
  const isOverCapacity = currentOccupancy > safeCapacity;
  const isAtCapacity = occupancyPercentage >= 100;
  const isWarningThreshold = occupancyPercentage >= 80 && occupancyPercentage < 100;

  // Recent 6 events
  const recentEvents = (events || []).slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Backend connection warning if offline */}
      {!isConnected && (
        <BackendAlertBanner onRetry={onRefresh} isChecking={isChecking} />
      )}

      {/* Critical Status Alert: Capacity Reached (≥100%) */}
      {isAtCapacity && (
        <div className="p-4 rounded-xl border border-[#F5B7B5] bg-[#FDEAE9] text-[#7B2422] shadow-2xs flex items-center justify-between flex-wrap gap-3 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-[#F9D4D2] text-[#7B2422]">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#641A19]">
                {isOverCapacity ? 'Emergency: Venue Exceeds Configured Capacity' : 'Capacity Threshold Reached (100%)'}
              </h4>
              <p className="text-xs text-[#7B2422] mt-0.5">
                Current attendee headcount is <strong>{currentOccupancy}</strong> against configured limit of <strong>{safeCapacity}</strong> seats ({occupancyPercentage.toFixed(1)}%). Advise door stewards to hold entrance queues.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate && onNavigate('settings')}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#C2413E] hover:bg-[#A83230] text-white transition shadow-2xs"
          >
            Adjust Capacity Limit
          </button>
        </div>
      )}

      {/* High Warning: 80% Capacity Threshold */}
      {isWarningThreshold && (
        <div className="p-4 rounded-xl border border-[#F0CD8C] bg-[#FFF6E5] text-[#7A4900] shadow-2xs flex items-center justify-between flex-wrap gap-3 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-[#FCE5B8] text-[#B26A00]">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#633900]">Capacity Advisory: 80% Occupancy Reached</h4>
              <p className="text-xs text-[#7A4900] mt-0.5">
                Meeting venue currently holds <strong>{currentOccupancy}</strong> attendees of <strong>{safeCapacity}</strong> maximum ({occupancyPercentage.toFixed(1)}%). {Math.max(0, safeCapacity - currentOccupancy)} spaces remaining.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold px-2.5 py-1 bg-[#FCE5B8] rounded-md text-[#7A4900] border border-[#F0CD8C]">
            {occupancyPercentage.toFixed(0)}% FULL
          </span>
        </div>
      )}

      {/* Action Notification */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-xl text-sm font-medium border flex items-center justify-between ${
            actionMessage.type === 'success'
              ? 'bg-[#DCE8DD] text-[#37553A] border-[#AEC3B0]'
              : 'bg-[#FDEAE9] text-[#7B2422] border-[#F5B7B5]'
          }`}
        >
          <span>{actionMessage.text}</span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-xs text-[#627466] hover:text-[#263B2B]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Video Processing Active Banner */}
      {videoStatus && videoStatus.status === 'running' && (
        <div className="p-4 rounded-xl bg-[#F7FAF6] border border-[#D4E0D5] shadow-forest-card flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-[#DCE8DD] text-[#37553A]">
              <Video className="w-5 h-5 animate-pulse text-[#37553A]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#263B2B]">Automated Video Detection Active</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#DCE8DD] text-[#37553A] font-bold border border-[#D4E0D5]">
                  {videoStatus.progress_percentage.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-[#627466] mt-0.5">
                Processed {videoStatus.processed_frames} / {videoStatus.total_frames} frames ({videoStatus.current_fps} FPS)
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate && onNavigate('video')}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#37553A] hover:bg-[#2A422D] text-white transition flex items-center gap-1.5 shadow-2xs"
          >
            <span>Monitor Job</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Primary KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Current Occupancy"
          value={stats ? currentOccupancy : isConnected ? 0 : '--'}
          subtitle={`${occupancyPercentage.toFixed(1)}% of ${safeCapacity} seats`}
          icon={Users}
          variant="forest"
          badge={
            isOverCapacity
              ? 'Over Capacity'
              : isAtCapacity
              ? 'At Capacity'
              : isWarningThreshold
              ? '80% Warning'
              : 'Normal'
          }
          badgeType={
            isAtCapacity
              ? 'danger'
              : isWarningThreshold
              ? 'warning'
              : 'neutral'
          }
        />
        <StatCard
          title="Total Meeting Entries"
          value={stats ? stats.total_entries : isConnected ? 0 : '--'}
          subtitle="Cumulative attendees arrived"
          icon={UserPlus}
          variant="accent"
        />
        <StatCard
          title="Total Meeting Exits"
          value={stats ? stats.total_exits : isConnected ? 0 : '--'}
          subtitle="Cumulative departures recorded"
          icon={UserMinus}
          variant="sage"
        />
        <StatCard
          title="Peak Concurrency"
          value={stats ? stats.peak_occupancy : isConnected ? 0 : '--'}
          subtitle="Highest headcount this session"
          icon={TrendingUp}
          variant="forest"
        />
      </div>

      {/* Middle Row: Capacity Gauge + Quick Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CapacityGauge
            current={currentOccupancy}
            capacity={safeCapacity}
            percentage={occupancyPercentage}
            status={stats?.status ?? 'Normal'}
            peak={stats?.peak_occupancy ?? 0}
          />
        </div>

        {/* Quick Door Counter Controls */}
        <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-[#37553A]" />
              <h3 className="text-sm font-bold text-[#263B2B]">Door Counter Controls</h3>
            </div>
            <p className="text-xs text-[#627466]">
              Manual gate overrides to record arrivals and departures into the SQLite database.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={handleQuickEntry}
                disabled={!isConnected || isActionLoading}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#DCE8DD] hover:bg-[#C8DBC9] border border-[#D4E0D5] text-[#263B2B] font-semibold text-sm transition shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed group"
              >
                <div className="p-2 rounded-lg bg-[#37553A] text-white mb-2 group-hover:scale-105 transition shadow-2xs">
                  <UserPlus className="w-5 h-5" />
                </div>
                <span>+1 Entry</span>
                <span className="text-[10px] text-[#627466] font-normal mt-0.5">Attendee enters</span>
              </button>

              <button
                onClick={handleQuickExit}
                disabled={!isConnected || isActionLoading}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#DCE8DD] hover:bg-[#C8DBC9] border border-[#D4E0D5] text-[#263B2B] font-semibold text-sm transition shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed group"
              >
                <div className="p-2 rounded-lg bg-[#6B9071] text-white mb-2 group-hover:scale-105 transition shadow-2xs">
                  <UserMinus className="w-5 h-5" />
                </div>
                <span>-1 Exit</span>
                <span className="text-[10px] text-[#627466] font-normal mt-0.5">Attendee departs</span>
              </button>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#D4E0D5] flex items-center justify-between text-xs text-[#627466]">
            <span>Video Ingestion</span>
            <button
              onClick={() => onNavigate && onNavigate('video')}
              className="text-[#37553A] hover:text-[#2A422D] font-bold flex items-center gap-1"
            >
              Analyze Footage
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Events Log Preview */}
      <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Activity className="w-4 h-4 text-[#37553A]" />
            <h3 className="text-base font-bold text-[#263B2B]">Recent Gathering Activity Log</h3>
            <span className="text-xs text-[#627466] font-mono">({recentEvents.length} records)</span>
          </div>
          <button
            onClick={() => onNavigate && onNavigate('events')}
            className="text-xs font-semibold text-[#37553A] hover:text-[#2A422D] transition flex items-center gap-1"
          >
            <span>View Full Log</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentEvents.length === 0 ? (
          <div className="py-12 text-center text-[#627466]">
            <Clock className="w-8 h-8 mx-auto mb-2 text-[#6B9071]" />
            <p className="text-sm font-medium text-[#263B2B]">No meeting events logged yet</p>
            <p className="text-xs text-[#627466] mt-1">
              Events detected through video tracking or manual door triggers will appear here in real-time.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#D4E0D5] text-xs font-semibold text-[#627466] uppercase tracking-wider bg-[#E8F0E8]/70">
                  <th className="py-3 px-4">Event ID</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Count</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Metadata / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D4E0D5]/70 font-mono text-xs">
                {recentEvents.map((evt) => {
                  const isEntry = evt.event_type === 'entry';
                  return (
                    <tr key={evt.id} className="hover:bg-[#DCE8DD]/50 transition">
                      <td className="py-3 px-4 text-[#627466]">#{evt.id}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                            isEntry
                              ? 'bg-[#DCE8DD] text-[#37553A] border-[#AEC3B0]'
                              : 'bg-[#E8F0E8] text-[#263B2B] border-[#D4E0D5]'
                          }`}
                        >
                          {isEntry ? (
                            <ArrowUpRight className="w-3 h-3 text-[#37553A]" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3 text-[#6B9071]" />
                          )}
                          <span className="capitalize">{evt.event_type}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-[#263B2B]">+{evt.count}</td>
                      <td className="py-3 px-4 text-[#263B2B] font-sans">
                        {new Date(evt.timestamp).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-[#627466] font-sans italic">
                        {evt.note || 'Computer vision line detection'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
