import React, { useState, useMemo } from 'react';
import {
  History,
  Filter,
  Search,
  RefreshCw,
  Download,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import BackendAlertBanner from '../components/BackendAlertBanner';

export default function EventHistory({
  events = [],
  isConnected,
  isChecking,
  onRefresh,
  limit,
  setLimit,
}) {
  const [filterType, setFilterType] = useState('all'); // all, entry, exit
  const [searchTerm, setSearchTerm] = useState('');

  // Filter and search
  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      const matchesType =
        filterType === 'all' || evt.event_type.toLowerCase() === filterType.toLowerCase();

      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        evt.id.toString().includes(term) ||
        (evt.note && evt.note.toLowerCase().includes(term)) ||
        (evt.timestamp && evt.timestamp.toLowerCase().includes(term));

      return matchesType && matchesSearch;
    });
  }, [events, filterType, searchTerm]);

  // Export to CSV
  const handleExportCSV = () => {
    if (!events.length) return;

    const headers = ['ID', 'Event Type', 'Count', 'Timestamp', 'Note'];
    const rows = filteredEvents.map((e) => [
      e.id,
      e.event_type,
      e.count,
      `"${e.timestamp}"`,
      `"${(e.note || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `meeting_events_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {!isConnected && (
        <BackendAlertBanner onRetry={onRefresh} isChecking={isChecking} />
      )}

      {/* Controls Header Card */}
      <div className="bg-[#F7FAF6] rounded-2xl p-6 border border-[#D4E0D5] shadow-forest-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#DCE8DD] text-[#37553A]">
              <History className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#263B2B]">Event Audit Trail</h3>
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#DCE8DD] text-[#37553A] font-bold border border-[#AEC3B0]">
                  {events.length} records retrieved
                </span>
              </div>
              <p className="text-xs text-[#627466] mt-0.5">
                Permanent SQLite log of all automated computer vision crossings and manual headcount modifications
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Limit Selector */}
            <div className="flex items-center gap-1.5 text-xs text-[#627466] bg-[#FFFFFF] border border-[#D4E0D5] rounded-xl px-2.5 py-1.5">
              <span>Show:</span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="bg-transparent text-[#263B2B] font-mono font-semibold focus:outline-none cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>

            {/* Export CSV Button */}
            <button
              onClick={handleExportCSV}
              disabled={!events.length}
              className="px-3.5 py-2 rounded-xl bg-[#FFFFFF] hover:bg-[#DCE8DD] text-[#263B2B] border border-[#D4E0D5] text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs disabled:opacity-40"
              title="Download currently filtered records as CSV"
            >
              <Download className="w-3.5 h-3.5 text-[#37553A]" />
              <span>Export CSV</span>
            </button>

            {/* Refresh Button in Dark Forest Green */}
            <button
              onClick={onRefresh}
              disabled={isChecking}
              className="px-3.5 py-2 rounded-xl bg-[#37553A] hover:bg-[#2A422D] text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>Refresh Log</span>
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="mt-6 pt-5 border-t border-[#D4E0D5] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Type Filter Buttons */}
          <div className="flex items-center gap-1.5 p-1 bg-[#E8F0E8] rounded-xl border border-[#D4E0D5] w-fit">
            {[
              { id: 'all', label: 'All Records' },
              { id: 'entry', label: 'Entries Only' },
              { id: 'exit', label: 'Exits Only' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  filterType === tab.id
                    ? 'bg-[#37553A] text-white font-bold shadow-2xs'
                    : 'text-[#627466] hover:text-[#263B2B]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-[#6B9071] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ID, note, timestamp..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-[#FFFFFF] border border-[#D4E0D5] rounded-xl text-xs text-[#263B2B] placeholder-[#627466] focus:outline-none focus:border-[#37553A] font-sans shadow-2xs"
            />
          </div>
        </div>
      </div>

      {/* Events Table Card */}
      <div className="bg-[#F7FAF6] rounded-2xl border border-[#D4E0D5] shadow-forest-card overflow-hidden">
        {filteredEvents.length === 0 ? (
          <div className="py-16 text-center text-[#627466]">
            <History className="w-10 h-10 mx-auto mb-3 text-[#6B9071]" />
            <p className="text-sm font-semibold text-[#263B2B]">No matching events found</p>
            <p className="text-xs text-[#627466] mt-1 max-w-sm mx-auto">
              {searchTerm || filterType !== 'all'
                ? 'Try adjusting your filters or search keywords.'
                : 'No entry/exit events have been logged in the meeting database yet.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-[#E8F0E8]/80 border-b border-[#D4E0D5] text-xs font-semibold text-[#627466] uppercase tracking-wider">
                  <th className="py-3.5 px-5">ID</th>
                  <th className="py-3.5 px-5">Type</th>
                  <th className="py-3.5 px-5">Headcount</th>
                  <th className="py-3.5 px-5">Timestamp (Local)</th>
                  <th className="py-3.5 px-5">Timestamp (ISO)</th>
                  <th className="py-3.5 px-5">Metadata / Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D4E0D5]/70 font-mono text-xs">
                {filteredEvents.map((evt) => {
                  const isEntry = evt.event_type === 'entry';
                  const dateObj = new Date(evt.timestamp);
                  const isValidDate = !isNaN(dateObj.getTime());

                  return (
                    <tr
                      key={evt.id}
                      className="hover:bg-[#DCE8DD]/50 transition duration-150"
                    >
                      <td className="py-3 px-5 text-[#627466] font-bold">#{evt.id}</td>
                      <td className="py-3 px-5">
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
                      <td className="py-3 px-5 font-bold text-[#263B2B]">+{evt.count}</td>
                      <td className="py-3 px-5 text-[#263B2B] font-sans">
                        {isValidDate ? dateObj.toLocaleString() : evt.timestamp}
                      </td>
                      <td className="py-3 px-5 text-[#627466] text-[11px]">
                        {evt.timestamp}
                      </td>
                      <td className="py-3 px-5 text-[#627466] font-sans italic max-w-xs truncate">
                        {evt.note || 'Video inference detection'}
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
