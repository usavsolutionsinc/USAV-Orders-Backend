'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Bell, Menu } from '@/components/Icons';
import { useAuth } from '@/contexts/AuthContext';

interface OpsHeaderBarProps {
  ablyStatus?: 'connected' | 'connecting' | 'disconnected';
}

export function GlobalHeaderBar({
  ablyStatus = 'connected',
}: OpsHeaderBarProps) {
  const { user } = useAuth();
  const [staffName, setStaffName] = useState<string>('Guest');
  const [staffRole, setStaffRole] = useState<string>('');
  const [scrolled, setScrolled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const readableRole = (user.role || '').replace(/_/g, ' ');
    setStaffRole(readableRole);

    fetch(`/api/staff?id=${user.staffId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { staff?: { name?: string } } | null) => {
        if (cancelled || !data?.staff) return;
        if (data.staff.name) setStaffName(data.staff.name);
      })
      .catch(() => { /* fallback */ });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const initials = staffName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <>
      <div ref={sentinelRef} className="absolute top-0 left-0 w-full h-px" aria-hidden="true" />

      <header
        className={`sticky top-0 z-40 w-full h-12 flex items-center justify-between px-3 sm:px-4 select-none border-b transition-colors ${
          scrolled
            ? 'bg-white/90 backdrop-blur-md border-gray-200'
            : 'bg-white/60 backdrop-blur-sm border-transparent'
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('open-mobile-drawer'))}
            aria-label="Open navigation"
            className="flex items-center justify-center w-8 h-8 rounded-md text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gray-900 flex items-center justify-center text-white font-black text-eyebrow tracking-tighter">
              US
            </div>
            <span className="hidden sm:inline-block text-caption font-black uppercase tracking-wide text-gray-900">
              USAV <span className="font-semibold text-amber-500 lowercase">.ops</span>
            </span>
          </div>

          <div className="hidden lg:flex items-center ml-2 pl-3 border-l border-gray-200">
            <span className="text-caption font-medium text-gray-500">
              {dateStr}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-50 border border-gray-200 shrink-0"
            title={`Realtime Status: ${ablyStatus}`}
          >
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                ablyStatus === 'connected' ? 'bg-emerald-400' :
                ablyStatus === 'connecting' ? 'bg-amber-400' : 'bg-rose-400'
              }`} />
              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                ablyStatus === 'connected' ? 'bg-emerald-500' :
                ablyStatus === 'connecting' ? 'bg-amber-500' : 'bg-rose-500'
              }`} />
            </span>
            <span className="hidden sm:inline text-mini font-black uppercase tracking-widest text-gray-500">Live</span>
          </div>

          <button
            className="relative p-1.5 rounded-md hover:bg-gray-100 text-gray-600 transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500 border border-white" />
          </button>

          <div className="w-px h-4 bg-gray-200 mx-0.5" />

          <div className="flex items-center gap-2 pl-1 cursor-pointer group">
            <div className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center text-white text-caption font-black border border-gray-200 group-hover:border-amber-400 transition-colors">
              {initials || '??'}
            </div>
            <div className="hidden lg:flex flex-col text-left leading-none">
              <span className="text-caption font-bold text-gray-900 group-hover:text-amber-600 transition-colors">
                {staffName}
              </span>
              <span className="text-mini font-bold uppercase tracking-wider text-gray-400 mt-0.5">
                {staffRole || 'Staff'}
              </span>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
