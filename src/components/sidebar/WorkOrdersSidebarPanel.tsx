'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

  useEffect(() => {
    setLocalSearch(searchParams.get('q') || '');
  }, [searchParams]);

  const fetchCounts = useCallback(() => {
    fetch(`/api/work-orders?queue=${queue}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.counts) setCounts({ ...EMPTY_COUNTS, ...json.counts });
      })
      .catch(() => {});
  }, [queue]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  useEffect(() => {
    window.addEventListener('dashboard-refresh', fetchCounts);
    return () => window.removeEventListener('dashboard-refresh', fetchCounts);
  }, [fetchCounts]);

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
    router.replace(`/work-orders?${params.toString()}`);
  };

  return (
    <div className="font-dm-sans flex h-full flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-gray-100 px-3 py-3">
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="Search queue, tracking, SKU…"
          variant="emerald"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
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
