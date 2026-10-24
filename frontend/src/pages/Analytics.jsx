import React, { useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import BackendAlertBanner from '../components/BackendAlertBanner';

export default function Analytics({ events = [], stats, isConnected, isChecking, onRefresh, venueCapacity = 100 }) {
  // Compute analytics exclusively from real events data
  const { occupancyTimeline, hourlyData, eventTypeDistribution, summary } = useMemo(() => {
    if (!events || events.length === 0) {
      return {
        occupancyTimeline: [],
        hourlyData: [],
        eventTypeDistribution: [],
        summary: { totalEntries: 0, totalExits: 0, netFlow: 0, avgBatch: 0 },
      };
    }

    // Sort events chronologically to reconstruct running occupancy curve
    const chronological = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let runningOccupancy = 0;
    let totalEntries = 0;
    let totalExits = 0;

    const timeline = chronological.map((evt, idx) => {
      const isEntry = evt.event_type.toLowerCase() === 'entry';
      if (isEntry) {
        runningOccupancy += evt.count;
        totalEntries += evt.count;
      } else {
        runningOccupancy = Math.max(0, runningOccupancy - evt.count);
        totalExits += evt.count;
      }

      const dateObj = new Date(evt.timestamp);
      const timeLabel = !isNaN(dateObj.getTime())
        ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : `Point ${idx + 1}`;

      return {
        id: evt.id,
        time: timeLabel,
        occupancy: runningOccupancy,
        count: evt.count,
        type: evt.event_type,
      };
    });

    // Hourly distribution
    const hourBuckets = {};
    for (let h = 0; h < 24; h++) {
      const label = `${h.toString().padStart(2, '0')}:00`;
      hourBuckets[label] = { hour: label, entries: 0, exits: 0 };
    }

    events.forEach((evt) => {
      const d = new Date(evt.timestamp);
      if (!isNaN(d.getTime())) {
        const hourLabel = `${d.getHours().toString().padStart(2, '0')}:00`;
        if (hourBuckets[hourLabel]) {
          if (evt.event_type.toLowerCase() === 'entry') {
            hourBuckets[hourLabel].entries += evt.count;
          } else {
            hourBuckets[hourLabel].exits += evt.count;
          }
        }
      }
    });

    const activeHours = Object.values(hourBuckets).filter((b) => b.entries > 0 || b.exits > 0);
    const hourlyList = activeHours.length > 0 ? activeHours : Object.values(hourBuckets).slice(8, 20);

    // Exact palette colors: #37553A (Dark forest), #6B9071 (Muted sage), #AEC3B0 (Light sage)
    const pieData = [
      { name: 'Arrivals', value: totalEntries, color: '#37553A' },
      { name: 'Departures', value: totalExits, color: '#6B9071' },
    ];

    const netFlow = totalEntries - totalExits;
    const avgBatch = (totalEntries + totalExits) / (events.length || 1);

    return {
      occupancyTimeline: timeline,
      hourlyData: hourlyList,
      eventTypeDistribution: pieData,
      summary: {
        totalEntries,
        totalExits,
        netFlow,
        avgBatch: avgBatch.toFixed(1),
      },
    };
  }, [events]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[#F7FAF6] border border-[#D4E0D5] p-3 rounded-xl shadow-md text-xs font-mono">
          <p className="text-[#627466] font-semibold mb-1">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className="flex justify-between gap-4">
              <span className="capitalize">{entry.name}:</span>
              <span className="font-bold text-[#263B2B]">{entry.value}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {!isConnected && (
        <BackendAlertBanner onRetry={onRefresh} isChecking={isChecking} />
      )}

      {/* Analytics KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#F7FAF6] rounded-2xl p-5 border border-[#D4E0D5] shadow-forest-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#627466] uppercase tracking-wider">
              Total Inflow Volume
            </span>
            <div className="p-2 rounded-xl bg-[#DCE8DD] text-[#37553A]">
              <ArrowUpRight className="w-5 h-5 text-[#37553A]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#37553A]">
              +{summary.totalEntries}
            </span>
            <span className="text-xs text-[#627466]">attendees</span>
          </div>
          <p className="text-xs text-[#627466] mt-1">Verified arrival transactions</p>
        </div>

        <div className="bg-[#F7FAF6] rounded-2xl p-5 border border-[#D4E0D5] shadow-forest-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#627466] uppercase tracking-wider">
              Total Outflow Volume
            </span>
            <div className="p-2 rounded-xl bg-[#E8F0E8] text-[#6B9071]">
              <ArrowDownRight className="w-5 h-5 text-[#6B9071]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#263B2B]">
              +{summary.totalExits}
            </span>
            <span className="text-xs text-[#627466]">attendees</span>
          </div>
          <p className="text-xs text-[#627466] mt-1">Verified exit transactions</p>
        </div>

        <div className="bg-[#F7FAF6] rounded-2xl p-5 border border-[#D4E0D5] shadow-forest-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#627466] uppercase tracking-wider">
              Net Hall Occupancy
            </span>
            <div className="p-2 rounded-xl bg-[#DCE8DD] text-[#37553A]">
              <Activity className="w-5 h-5 text-[#37553A]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#263B2B]">
              {summary.netFlow >= 0 ? `+${summary.netFlow}` : summary.netFlow}
            </span>
            <span className="text-xs text-[#627466]">net in room</span>
          </div>
          <p className="text-xs text-[#627466] mt-1">Arrivals minus departures</p>
        </div>

        <div className="bg-[#F7FAF6] rounded-2xl p-5 border border-[#D4E0D5] shadow-forest-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#627466] uppercase tracking-wider">
              Peak Logged
            </span>
            <div className="p-2 rounded-xl bg-[#D4E0D5] text-[#37553A]">
              <TrendingUp className="w-5 h-5 text-[#37553A]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#263B2B]">
              {stats?.peak_occupancy ?? 0}
            </span>
            <span className="text-xs text-[#627466]">concurrency</span>
          </div>
          <p className="text-xs text-[#627466] mt-1">Max attendance during session</p>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="bg-[#F7FAF6] rounded-2xl p-16 border border-[#D4E0D5] shadow-forest-card text-center">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 text-[#6B9071]" />
          <h4 className="text-base font-bold text-[#263B2B]">No Gathering Data Available</h4>
          <p className="text-xs text-[#627466] mt-1.5 max-w-md mx-auto">
            Analytics charts are synthesized from verified event detections. Ingest a meeting video or
            simulate entry events on the dashboard to populate these charts.
          </p>
        </div>
      ) : (
        <>
          {/* Main Chart: Reconstructed Occupancy Flow Over Event Timeline */}
          <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-base font-bold text-[#263B2B]">Occupancy Trajectory</h3>
                <p className="text-xs text-[#627466] mt-0.5">
                  Sequential running headcount reconstructed from chronological event records
                </p>
              </div>
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-[#DCE8DD] text-[#37553A] border border-[#AEC3B0] font-bold">
                {occupancyTimeline.length} events graphed
              </span>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={occupancyTimeline}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="forestOccupancyGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6B9071" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6B9071" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#D4E0D5" vertical={false} />
                  <XAxis
                    dataKey="time"
                    stroke="#627466"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: '#D4E0D5' }}
                  />
                  <YAxis
                    stroke="#627466"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: '#D4E0D5' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="occupancy"
                    name="Occupancy"
                    stroke="#37553A"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#forestOccupancyGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Secondary Charts: Hourly In/Out + Proportion Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Hourly Distribution (2 cols) */}
            <div className="lg:col-span-2 bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
              <div className="mb-6">
                <h3 className="text-base font-bold text-[#263B2B]">Hourly Footfall Activity</h3>
                <p className="text-xs text-[#627466] mt-0.5">
                  Arrivals and departures categorized by hour of occurrence
                </p>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={hourlyData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#D4E0D5" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      stroke="#627466"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: '#D4E0D5' }}
                    />
                    <YAxis
                      stroke="#627466"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: '#D4E0D5' }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Bar dataKey="entries" name="Arrivals" fill="#37553A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="exits" name="Departures" fill="#6B9071" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Proportion Pie Chart (1 col) */}
            <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-[#263B2B]">Turnover Ratio</h3>
                <p className="text-xs text-[#627466] mt-0.5">Proportion of Inflow vs Outflow</p>
              </div>

              <div className="h-52 w-full my-auto flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={eventTypeDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {eventTypeDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-[#D4E0D5] text-center font-mono">
                <div className="p-2 rounded-xl bg-[#DCE8DD] border border-[#AEC3B0]">
                  <span className="text-[10px] text-[#37553A] font-sans block font-bold">Total In</span>
                  <span className="text-sm font-bold text-[#263B2B]">{summary.totalEntries}</span>
                </div>
                <div className="p-2 rounded-xl bg-[#E8F0E8] border border-[#D4E0D5]">
                  <span className="text-[10px] text-[#6B9071] font-sans block font-bold">Total Out</span>
                  <span className="text-sm font-bold text-[#263B2B]">{summary.totalExits}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
