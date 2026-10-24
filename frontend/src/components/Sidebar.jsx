import React from 'react';
import {
  LayoutDashboard,
  Video,
  History,
  BarChart3,
  Settings,
  ShieldCheck,
  X,
  Users,
} from 'lucide-react';

export default function Sidebar({
  activeTab,
  setActiveTab,
  isMobileOpen,
  setIsMobileOpen,
  venueCapacity = 100,
}) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'video', label: 'Video Processing', icon: Video },
    { id: 'events', label: 'Event History', icon: History },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#263B2B]/40 backdrop-blur-2xs lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar Container: Pale Green #E8F0E8 */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-[#E8F0E8] border-r border-[#D4E0D5] flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-[#D4E0D5]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#37553A] flex items-center justify-center text-white font-bold shadow-2xs">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-base tracking-tight text-[#263B2B] flex items-center gap-1.5">
                CrowdSense <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#DCE8DD] text-[#37553A] font-bold border border-[#D4E0D5]">AI</span>
              </span>
              <p className="text-[10px] text-[#627466] font-medium">Meeting Capacity Monitor</p>
            </div>
          </div>

          <button
            onClick={() => setIsMobileOpen(false)}
            className="lg:hidden text-[#627466] hover:text-[#263B2B] p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-[#37553A] text-white font-bold shadow-sm'
                    : 'text-[#263B2B] hover:text-[#37553A] hover:bg-[#DCE8DD]'
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? 'text-white' : 'text-[#6B9071]'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Meeting & Setup Summary Footer */}
        <div className="p-4 border-t border-[#D4E0D5] bg-[#E8F0E8]/70">
          <div className="p-3 rounded-xl bg-[#F7FAF6] border border-[#D4E0D5] shadow-2xs">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-[#37553A]" />
              <span className="text-xs font-bold text-[#263B2B]">Venue Setup</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#627466]">
              <span>Capacity Limit</span>
              <span className="font-mono font-bold text-[#37553A] px-1.5 py-0.5 rounded bg-[#DCE8DD]">
                {venueCapacity} seats
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#627466] mt-1.5">
              <span>Detection Model</span>
              <span className="font-mono font-semibold text-[#263B2B]">YOLOv8 + ByteTrack</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
