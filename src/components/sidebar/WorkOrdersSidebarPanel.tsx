'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  type QueueKey,
  type QueueCounts,
  QUEUE_ITEMS,
  EMPTY_COUNTS,
  normalizeQueue,
} from '@/components/work-orders/types';

export function WorkOrdersSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queue = normalizeQueue(searchParams.get('queue'));
  const [localSearch, setLocalSearch] = useState(searchParams.get('q') || '');
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [pickupDates, setPickupDates] = useState<Array<{ pickup_date: string; item_count: number; total_value: string }>>([]);

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

        {QUEUE_ITEMS.map((item) => {
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
