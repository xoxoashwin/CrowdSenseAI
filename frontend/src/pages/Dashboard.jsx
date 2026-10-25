import React, { useState, useEffect, useRef } from 'react';
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
  const messageTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    };
  }, []);

  const handleQuickEntry = async () => {
    try {
      setIsActionLoading(true);
      const res = await recordEntry({ count: 1, note: 'Meeting Hall Manual Entry' });
      if (isMountedRef.current) {
        setActionMessage({ text: res.message, type: 'success' });
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      if (isMountedRef.current) {
        setActionMessage({ text: err.message, type: 'error' });
      }
    } finally {
      if (isMountedRef.current) {
        setIsActionLoading(false);
        if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
        messageTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) setActionMessage(null);
        }, 4000);
      }
    }
  };

  const handleQuickExit = async () => {
    try {
      setIsActionLoading(true);
      const res = await recordExit({ count: 1, note: 'Meeting Hall Manual Exit' });
      if (isMountedRef.current) {
        setActionMessage({ text: res.message, type: 'success' });
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      if (isMountedRef.current) {
        setActionMessage({ text: err.message, type: 'error' });
      }
    } finally {
      if (isMountedRef.current) {
        setIsActionLoading(false);
        if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
        messageTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) setActionMessage(null);
        }, 4000);
      }
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
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#37553A] hover:bg-[#263B2B] text-white transition shadow-xs"
          >
            View Live Stream
          </button>
        </div>
      )}

      {/* Live Occupancy Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard
          title="Current Headcount"
          value={stats ? stats.current_occupancy : '--'}
          subtitle={`Capacity Limit: ${safeCapacity}`}
          icon={Users}
          color="green"
          badge={stats ? stats.status : 'Connecting'}
        />
        <StatCard
          title="Total Inflow (Entries)"
          value={stats ? stats.total_entries : '--'}
          subtitle="Cumulative verified arrivals"
          icon={UserPlus}
          color="emerald"
        />
        <StatCard
          title="Total Outflow (Exits)"
          value={stats ? stats.total_exits : '--'}
          subtitle="Cumulative verified departures"
          icon={UserMinus}
          color="teal"
        />
        <StatCard
          title="Peak Attendance"
          value={stats ? stats.peak_occupancy : '--'}
          subtitle="Highest headcount recorded"
          icon={TrendingUp}
          color="amber"
        />
      </div>

      {/* Real-time Visualizations & Doorway Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Capacity Gauge Meter - Prominent Venue Monitor */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col">
          <CapacityGauge
            current={currentOccupancy}
            capacity={safeCapacity}
            percentage={occupancyPercentage}
            status={stats?.status || 'Normal'}
            peak={stats?.peak_occupancy ?? 0}
            availableSpaces={stats?.available_spaces ?? Math.max(0, safeCapacity - currentOccupancy)}
          />
        </div>

        {/* Doorway Steward Control - Compact Action Card */}
        <div className="lg:col-span-5 xl:col-span-4 bg-[#F7FAF6] rounded-2xl p-4 sm:p-5 border border-[#D4E0D5] shadow-forest-card flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#D4E0D5]">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-[#263B2B]">Doorway Steward Control</h3>
                <p className="text-xs text-[#627466]">
                  Manual overrides for door marshals
                </p>
              </div>
              <span className="text-xs font-mono text-[#627466] flex items-center gap-1 bg-[#E8F0E8] px-2 py-0.5 rounded-full border border-[#D4E0D5]">
                <Activity className="w-3.5 h-3.5 text-[#37553A]" />
                Live Sync
              </span>
            </div>

            <div className="flex flex-col gap-2.5 my-4">
              <button
                type="button"
                onClick={handleQuickEntry}
                disabled={isActionLoading || !isConnected}
                className="group relative flex items-center gap-3 p-3 rounded-xl border border-[#AEC3B0] bg-[#E8F0E8]/60 hover:bg-[#DCE8DD] hover:border-[#37553A] transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-[#37553A] text-white flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition shadow-2xs">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#263B2B]">+1 Inflow</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#DCE8DD] text-[#37553A] font-semibold border border-[#AEC3B0]">Manual Entry</span>
                  </div>
                  <span className="text-xs text-[#627466] block truncate">
                    Person entered main auditorium
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={handleQuickExit}
                disabled={isActionLoading || !isConnected}
                className="group relative flex items-center gap-3 p-3 rounded-xl border border-[#CBD5E1] bg-[#F1F5F9]/60 hover:bg-[#E2E8F0] hover:border-[#64748B] transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-[#64748B] text-white flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition shadow-2xs">
                  <UserMinus className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#1E293B]">-1 Outflow</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#E2E8F0] text-[#475569] font-semibold border border-[#CBD5E1]">Manual Exit</span>
                  </div>
                  <span className="text-xs text-[#64748B] block truncate">
                    Person exited meeting hall
                  </span>
                </div>
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-[#D4E0D5] flex items-center justify-between text-xs text-[#627466]">
            <span className="truncate">Saved to local SQLite database</span>
            <button
              onClick={() => onNavigate && onNavigate('events')}
              className="text-[#37553A] font-semibold hover:underline flex items-center gap-1 flex-shrink-0 ml-2"
            >
              Audit Log
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Recent Activity Audit Table */}
      <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
        <div className="flex items-center justify-between pb-4 border-b border-[#D4E0D5] mb-4">
          <div>
            <h3 className="text-base font-bold text-[#263B2B]">Live Footfall Audit Feed</h3>
            <p className="text-xs text-[#627466] mt-0.5">
              Verified computer-vision doorway crossing events and manual steward adjustments.
            </p>
          </div>
          <button
            onClick={() => onNavigate && onNavigate('events')}
            className="text-xs font-semibold text-[#37553A] hover:underline flex items-center gap-1"
          >
            View Complete Trail
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
