import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import VideoProcessing from './pages/VideoProcessing';
import EventHistory from './pages/EventHistory';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import { getHealth, getStats, getEvents, getVideoStatus } from './api';

const STORAGE_KEY_CAPACITY = 'crowdsense_venue_capacity';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Configurable Venue Capacity with localStorage persistence (Default: 100)
  const [venueCapacity, setVenueCapacity] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CAPACITY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to read capacity from localStorage:', e);
    }
    return 100;
  });

  const updateVenueCapacity = (newCapacity) => {
    const parsed = parseInt(newCapacity, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setVenueCapacity(parsed);
      try {
        localStorage.setItem(STORAGE_KEY_CAPACITY, parsed.toString());
      } catch (e) {
        console.warn('Failed to save capacity to localStorage:', e);
      }
    }
  };

  // Core application data from FastAPI backend
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [events, setEvents] = useState([]);
  const [videoStatus, setVideoStatus] = useState(null);
  const [limit, setLimit] = useState(50);

  // Connection & sync state
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Synchronize data from backend
  const fetchData = useCallback(async () => {
    setIsChecking(true);
    try {
      const [healthRes, statsRes, eventsRes, videoRes] = await Promise.allSettled([
        getHealth(),
        getStats(),
        getEvents(limit),
        getVideoStatus(),
      ]);

      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value);
        setIsConnected(true);
      } else {
        setIsConnected(false);
      }

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value);
      }

      if (eventsRes.status === 'fulfilled') {
        setEvents(eventsRes.value.events || []);
      }

      if (videoRes.status === 'fulfilled') {
        setVideoStatus(videoRes.value);
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.warn('Backend connection error:', err);
      setIsConnected(false);
    } finally {
      setIsChecking(false);
    }
  }, [limit]);

  // Initial fetch and 5s polling interval
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchData]);

  const pageMeta = {
    dashboard: {
      title: 'Meeting Occupancy Dashboard',
      subtitle: 'Real-time attendee headcounts, capacity thresholds, and doorway crossings',
    },
    video: {
      title: 'Video Ingestion & Tracking',
      subtitle: 'Process hall footage with YOLOv8 person detection and ByteTrack',
    },
    events: {
      title: 'Event Audit Trail',
      subtitle: 'Complete chronological record of all arrival and departure events stored in SQLite',
    },
    analytics: {
      title: 'Meeting Attendance Analytics',
      subtitle: 'Attendance trajectory curve, hourly footfall distribution, and inflow/outflow metrics',
    },
    settings: {
      title: 'Meeting & Venue Setup',
      subtitle: 'Configure maximum hall capacity limit, inspect backend infrastructure, and manage database',
    },
  };

  const currentMeta = pageMeta[activeTab] || pageMeta.dashboard;

  return (
    <div className="min-h-screen bg-[#AEC3B0] text-[#263B2B] flex flex-col antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isMobileOpen={isMobileOpen}
        setIsMobileOpen={setIsMobileOpen}
        venueCapacity={venueCapacity}
      />

      {/* Main Content Area */}
      <div className="lg:pl-64 flex flex-col flex-1 min-w-0 bg-[#AEC3B0]">
        <Header
          title={currentMeta.title}
          subtitle={currentMeta.subtitle}
          isConnected={isConnected}
          isChecking={isChecking}
          onRefresh={fetchData}
          lastUpdated={lastUpdated}
          setIsMobileOpen={setIsMobileOpen}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <Dashboard
              stats={stats}
              events={events}
              isConnected={isConnected}
              isChecking={isChecking}
              onRefresh={fetchData}
              videoStatus={videoStatus}
              onNavigate={(tab) => setActiveTab(tab)}
              venueCapacity={venueCapacity}
            />
          )}

          {activeTab === 'video' && (
            <VideoProcessing
              isConnected={isConnected}
              isChecking={isChecking}
              onRefreshStats={fetchData}
              videoStatus={videoStatus}
              setVideoStatus={setVideoStatus}
            />
          )}

          {activeTab === 'events' && (
            <EventHistory
              events={events}
              isConnected={isConnected}
              isChecking={isChecking}
              onRefresh={fetchData}
              limit={limit}
              setLimit={setLimit}
            />
          )}

          {activeTab === 'analytics' && (
            <Analytics
              events={events}
              stats={stats}
              isConnected={isConnected}
              isChecking={isChecking}
              onRefresh={fetchData}
              venueCapacity={venueCapacity}
            />
          )}

          {activeTab === 'settings' && (
            <Settings
              health={health}
              stats={stats}
              isConnected={isConnected}
              isChecking={isChecking}
              onRefresh={fetchData}
              venueCapacity={venueCapacity}
              onUpdateVenueCapacity={updateVenueCapacity}
            />
          )}
        </main>
      </div>
    </div>
  );
}
