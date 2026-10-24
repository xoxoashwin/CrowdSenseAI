import React from 'react';
import { Menu, Clock } from 'lucide-react';
import BackendStatusBadge from './BackendStatusBadge';

export default function Header({
  title,
  subtitle,
  isConnected,
  isChecking,
  onRefresh,
  lastUpdated,
  setIsMobileOpen,
}) {
  return (
    <header className="h-20 border-b border-[#D4E0D5] bg-[#F7FAF6]/95 backdrop-blur-2xs sticky top-0 z-30 px-4 sm:px-8 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button
          onClick={() => setIsMobileOpen(true)}
          className="lg:hidden p-2 rounded-xl bg-[#DCE8DD] text-[#37553A] hover:bg-[#C8DBC9] border border-[#D4E0D5] transition"
          aria-label="Open navigation sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#263B2B]">{title}</h1>
          {subtitle && <p className="text-xs text-[#627466] mt-0.5 hidden sm:block">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-5">
        {lastUpdated && (
          <div className="hidden md:flex items-center gap-1.5 text-xs text-[#627466] font-mono">
            <Clock className="w-3.5 h-3.5 text-[#6B9071]" />
            <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
          </div>
        )}

        <BackendStatusBadge
          isConnected={isConnected}
          isChecking={isChecking}
          onRefresh={onRefresh}
        />
      </div>
    </header>
  );
}
