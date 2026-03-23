'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderBandClass, sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  type QueueKey,
  type QueueCounts,
  QUEUE_ITEMS,
  EMPTY_COUNTS,
  normalizeQueue,
} from '@/components/work-orders/types';

const ASSIGNMENT_FOCUS_TABS = [
  { id: 'all_unassigned', label: 'Unassigned', color: 'orange' as const },
  { id: 'all_assigned', label: 'Assigned', color: 'emerald' as const },
];

const SIDEBAR_QUEUE_ITEMS = QUEUE_ITEMS.filter(
  (item) => item.key !== 'all_unassigned' && item.key !== 'all_assigned'
);

export function WorkOrdersSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queue = normalizeQueue(searchParams.get('queue'));
  const [localSearch, setLocalSearch] = useState(searchParams.get('q') || '');
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [pickupDates, setPickupDates] = useState<Array<{ pickup_date: string; item_count: number; total_value: string }>>([]);
  const canStartAssignSession = queue !== 'local_pickups' && queue !== 'stock_replenish';

  useEffect(() => {
    setLocalSearch(searchParams.get('q') || '');
  }, [searchParams]);

  const fetchCounts = useCallback(() => {
    fetch(`/api/work-orders?queue=${queue}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.counts) setCounts({ ...EMPTY_COUNTS, ...json.counts });
      })
      .catch(() => {});
  }, [queue]);

  const fetchPickupDates = useCallback(() => {
    if (queue !== 'local_pickups') return;
    fetch(`/api/local-pickups`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (Array.isArray(json?.dates)) setPickupDates(json.dates);
      })
      .catch(() => setPickupDates([]));
  }, [queue]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  useEffect(() => { fetchPickupDates(); }, [fetchPickupDates]);

  useEffect(() => {
    window.addEventListener('dashboard-refresh', fetchCounts);
    window.addEventListener('dashboard-refresh', fetchPickupDates);
    return () => {
      window.removeEventListener('dashboard-refresh', fetchCounts);
      window.removeEventListener('dashboard-refresh', fetchPickupDates);
    };
  }, [fetchCounts, fetchPickupDates]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (localSearch.trim()) params.set('q', localSearch.trim());
      else params.delete('q');
      router.replace(`/work-orders?${params.toString()}`);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [localSearch, router, searchParams]);

  const updateQueue = (nextQueue: QueueKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('queue', nextQueue);
    params.delete('entityType');
    params.delete('entityId');
    if (nextQueue !== 'local_pickups') params.delete('pickupDate');
    router.replace(`/work-orders?${params.toString()}`);
  };

  const updatePickupDate = (pickupDate: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('queue', 'local_pickups');
    params.set('pickupDate', pickupDate);
    params.delete('entityType');
    params.delete('entityId');
    router.replace(`/work-orders?${params.toString()}`);
  };

  useEffect(() => {
    if (queue !== 'local_pickups') return;
    if (searchParams.get('pickupDate')) return;
    if (!pickupDates[0]?.pickup_date) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('pickupDate', pickupDates[0].pickup_date);
    router.replace(`/work-orders?${params.toString()}`);
  }, [pickupDates, queue, router, searchParams]);

  return (
    <div className="font-dm-sans flex h-full flex-col overflow-hidden bg-white">
      <div className={`${sidebarHeaderBandClass} px-3 py-2`}>
        <div className="rounded-xl bg-slate-100/90 p-1">
          <div className="grid grid-cols-2 gap-1">
            {ASSIGNMENT_FOCUS_TABS.map((tab) => {
              const active = queue === tab.id;
              const count = counts[tab.id as QueueKey] ?? 0;
              const activeClass =
                tab.id === 'all_unassigned'
                  ? 'bg-white text-orange-600 shadow-[0_1px_4px_rgba(194,65,12,0.12)]'
                  : 'bg-white text-emerald-700 shadow-[0_1px_4px_rgba(5,150,105,0.14)]';
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => updateQueue(tab.id as QueueKey)}
                  className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                    active ? activeClass : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span>{tab.label}</span>
                  {count > 0 && (
                    <span
                      className={`inline-flex min-w-[14px] items-center justify-center rounded-full px-1 text-[8px] font-black ${
                        active ? 'bg-current/15 text-current' : 'bg-slate-300/70 text-slate-600'
                      }`}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={sidebarHeaderRowClass}>
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="Search queue, tracking, SKU…"
          variant="emerald"
          className="w-full"
        />
      </div>

      <div className={`${sidebarHeaderBandClass} px-3 pb-2`}>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('work-orders-open-assign-session'))}
          disabled={!canStartAssignSession}
          className={`h-11 w-full rounded-xl text-[10px] font-black uppercase tracking-[0.18em] transition-colors ${
            canStartAssignSession
              ? 'bg-slate-900 text-white hover:bg-black'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          Start Assign Session
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {queue === 'local_pickups' && pickupDates.length > 0 && (
          <div className="mb-3 border-b border-[var(--color-neutral-200)] pb-2">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-neutral-700)]">
              Pickup Dates
            </p>
            {pickupDates.map((item) => {
              const active = searchParams.get('pickupDate') === item.pickup_date;
              const date = new Date(`${item.pickup_date}T12:00:00`);
              const label = Number.isNaN(date.getTime())
                ? item.pickup_date
                : new Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  }).format(date);
              return (
                <button
                  key={item.pickup_date}
                  type="button"
                  onClick={() => updatePickupDate(item.pickup_date)}
                  className={`group relative flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors ${
                    active ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold tracking-tight">{label}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                      {item.item_count} items · ${Number(item.total_value || 0).toFixed(2)}
                    </div>
                  </div>
                  {active && <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-slate-950 rounded-full" />}
                </button>
              );
            })}
          </div>
        )}

        {SIDEBAR_QUEUE_ITEMS.map((item) => {
          const active = item.key === queue;
          const count = counts[item.key] ?? 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => updateQueue(item.key)}
              className={`group relative flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors ${
                active ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <span className="text-[12px] font-semibold tracking-tight">{item.label}</span>
              <span
                className={`min-w-[1.75rem] text-right text-[11px] font-bold tabular-nums ${
                  active ? 'text-slate-900' : count > 0 ? 'text-slate-500' : 'text-slate-300'
                }`}
              >
                {count}
              </span>
              {/* Active: solid black bottom line */}
              {active && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-slate-950 rounded-full" />
              )}
              {/* Hover: black bottom line (only when not active) */}
              {!active && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-slate-900 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
