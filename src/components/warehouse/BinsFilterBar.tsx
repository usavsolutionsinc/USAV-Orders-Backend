'use client';

/**
 * Filter chip row + search + room dropdown for the Bins tab.
 * All state is URL-driven (?status=, ?room=, ?q=) so deep links stay shareable.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BinsOverviewCounts } from '@/hooks/useBinsOverview';
import type { LocationRecord } from '@/hooks/useLocations';

export type BinFilterStatus = 'all' | 'empty' | 'low' | 'over' | 'stale';

interface Props {
  counts: BinsOverviewCounts;
  rooms: LocationRecord[];
  status: BinFilterStatus;
  room: string;
  /** Called when any URL-bound filter changes. */
  onParamChange: (key: 'status' | 'room' | 'q', value: string) => void;
}

const CHIPS: { id: BinFilterStatus; label: string; tone: string }[] = [
  { id: 'all',   label: 'All',           tone: 'bg-surface-sunken text-text-default ring-border-soft' },
  { id: 'empty', label: 'Empty',         tone: 'bg-surface-canvas text-text-muted ring-border-soft' },
  { id: 'low',   label: 'Low',           tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  { id: 'over',  label: 'Over cap',      tone: 'bg-red-50 text-red-700 ring-red-200' },
  { id: 'stale', label: 'Stale',         tone: 'bg-purple-50 text-purple-700 ring-purple-200' },
];

const ACTIVE_TONE: Record<BinFilterStatus, string> = {
  all:   'bg-surface-inverse text-white ring-surface-inverse',
  empty: 'bg-slate-700 text-white ring-slate-700', // ds-allow-raw-neutral: identity/tone hue — Empty's slate must stay distinct from All (= surface-inverse)
  low:   'bg-amber-600 text-white ring-amber-600',
  over:  'bg-red-600 text-white ring-red-600',
  stale: 'bg-purple-600 text-white ring-purple-600',
};

export function BinsFilterBar({ counts, rooms, status, room, onParamChange }: Props) {
  const countFor = useCallback(
    (id: BinFilterStatus): number => {
      switch (id) {
        case 'all':   return counts.total;
        case 'empty': return counts.empty;
        case 'low':   return counts.low_stock;
        case 'over':  return counts.over_capacity;
        case 'stale': return counts.stale;
      }
    },
    [counts],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => {
          const active = status === c.id;
          const n = countFor(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onParamChange('status', c.id === 'all' ? '' : c.id)}
              aria-pressed={active}
              className={`ds-raw-button inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-label font-semibold ring-1 transition-all active:scale-95 ${
                active ? ACTIVE_TONE[c.id] : c.tone
              }`}
            >
              {c.label}
              <span className={`tabular-nums text-micro ${active ? 'opacity-90' : 'opacity-60'}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="max-w-xs">
        <select
          value={room}
          onChange={(e) => onParamChange('room', e.target.value)}
          className="h-10 w-full rounded-md border border-border-soft bg-surface-card px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        >
          <option value="">All rooms</option>
          {rooms.map((r) => {
            const name = r.room || r.name;
            return (
              <option key={r.id} value={name}>
                {name} {r.zone_letter ? `(${r.zone_letter})` : ''}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}

/**
 * Hook for URL-bound bin filter params. Reads ?status=, ?room=, ?q= and
 * returns a setter that updates a single key.
 */
export function useBinsFilterParams() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const status: BinFilterStatus = (() => {
    const raw = searchParams.get('status');
    if (raw === 'empty' || raw === 'low' || raw === 'over' || raw === 'stale') return raw;
    return 'all';
  })();
  const room = searchParams.get('room') ?? '';
  const q = searchParams.get('q') ?? '';

  const onParamChange = useCallback(
    (key: 'status' | 'room' | 'q', value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      // Keep the inventory tab parameter alive.
      if (!next.get('tab')) next.set('tab', 'bins');
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/inventory?${next.toString()}`);
    },
    [router, searchParams],
  );

  return { status, room, q, onParamChange };
}

/** Filter the table rows according to the active status chip. */
export function filterRowsByStatus<T extends {
  is_empty: boolean; has_low_stock: boolean; is_over_capacity: boolean; is_stale: boolean;
}>(rows: T[], status: BinFilterStatus): T[] {
  switch (status) {
    case 'all':   return rows;
    case 'empty': return rows.filter((r) => r.is_empty);
    case 'low':   return rows.filter((r) => r.has_low_stock);
    case 'over':  return rows.filter((r) => r.is_over_capacity);
    case 'stale': return rows.filter((r) => r.is_stale);
  }
}
