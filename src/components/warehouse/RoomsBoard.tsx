'use client';

/**
 * Rooms board for the main area. Grid of room cards with:
 *   - room name + zone letter chip
 *   - bin count
 *   - total qty across bins
 *   - fill % bar (sum qty / sum capacity for bins that have a capacity)
 *   - status badges (empty / low / over / stale counts)
 *   - last activity timestamp (latest updated_at among the room's bins)
 *
 * Card click opens the room editor in the sidebar's RoomManager (via URL).
 * Add / Edit-mode toggle live in the header.
 */

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocations } from '@/hooks/useLocations';
import { useBinsOverview } from '@/hooks/useBinsOverview';
import { FillBar } from './FillBar';
import { Pencil } from '@/components/Icons';

export function RoomsBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { rooms, loading: roomsLoading } = useLocations();
  const { rows: bins, loading: binsLoading } = useBinsOverview({ pollMs: 0 });

  const summaries = useMemo(() => {
    type Summary = {
      key: string;
      room: string;
      letter: string | null;
      binCount: number;
      totalQty: number;
      totalCapacity: number;
      capacitySamples: number;
      empty: number;
      low: number;
      over: number;
      stale: number;
      lastActivityAt: string | null;
    };

    const byRoom = new Map<string, Summary>();
    // Seed from rooms table so empty rooms still appear.
    for (const r of rooms) {
      const name = (r.room || r.name).trim();
      if (!name) continue;
      byRoom.set(name, {
        key: name,
        room: name,
        letter: r.zone_letter,
        binCount: 0,
        totalQty: 0,
        totalCapacity: 0,
        capacitySamples: 0,
        empty: 0, low: 0, over: 0, stale: 0,
        lastActivityAt: null,
      });
    }
    for (const b of bins) {
      const name = (b.room || '').trim();
      if (!name) continue;
      let s = byRoom.get(name);
      if (!s) {
        s = {
          key: name, room: name, letter: b.zone_letter,
          binCount: 0, totalQty: 0, totalCapacity: 0, capacitySamples: 0,
          empty: 0, low: 0, over: 0, stale: 0, lastActivityAt: null,
        };
        byRoom.set(name, s);
      }
      s.binCount += 1;
      s.totalQty += b.total_qty;
      if (b.capacity != null && b.capacity > 0) {
        s.totalCapacity += b.capacity;
        s.capacitySamples += 1;
      }
      if (b.is_empty) s.empty += 1;
      if (b.has_low_stock) s.low += 1;
      if (b.is_over_capacity) s.over += 1;
      if (b.is_stale) s.stale += 1;
      if (b.last_counted && (!s.lastActivityAt || b.last_counted > s.lastActivityAt)) {
        s.lastActivityAt = b.last_counted;
      }
    }

    return Array.from(byRoom.values()).sort((a, b) => a.room.localeCompare(b.room));
  }, [rooms, bins]);

  const openInSidebar = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'rooms');
    params.set('edit', '1');
    router.replace(`/inventory?${params.toString()}`);
  };

  const loading = roomsLoading || binsLoading;

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Rooms</h1>
          <p className="text-sm text-gray-500">
            {loading
              ? 'Loading…'
              : `${summaries.length} room${summaries.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          type="button"
          onClick={openInSidebar}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit rooms
        </button>
      </header>

      {loading && summaries.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          Loading rooms…
        </div>
      ) : summaries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-gray-700">No rooms yet</p>
          <p className="mt-1 text-xs text-gray-500">
            Open the Rooms sidebar to add your first one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((s) => {
            const fill =
              s.capacitySamples > 0 && s.totalCapacity > 0
                ? s.totalQty / s.totalCapacity
                : null;
            return (
              <RoomCard
                key={s.key}
                room={s.room}
                letter={s.letter}
                binCount={s.binCount}
                totalQty={s.totalQty}
                fillPct={fill}
                totalCapacity={s.capacitySamples > 0 ? s.totalCapacity : null}
                empty={s.empty}
                low={s.low}
                over={s.over}
                stale={s.stale}
                onClick={() => {
                  const params = new URLSearchParams(searchParams.toString());
                  params.set('tab', 'rooms');
                  params.set('room', s.room);
                  router.replace(`/inventory?${params.toString()}`);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface RoomCardProps {
  room: string;
  letter: string | null;
  binCount: number;
  totalQty: number;
  fillPct: number | null;
  totalCapacity: number | null;
  empty: number;
  low: number;
  over: number;
  stale: number;
  onClick: () => void;
}

function RoomCard(p: RoomCardProps) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      className="rounded-2xl border border-gray-200 bg-white p-4 text-left transition-all hover:border-blue-200 hover:bg-blue-50/30 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-gray-900">{p.room}</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {p.binCount} bin{p.binCount === 1 ? '' : 's'} · {p.totalQty} unit{p.totalQty === 1 ? '' : 's'}
          </p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono text-base font-semibold ${
          p.letter
            ? 'bg-gradient-to-br from-blue-50 to-blue-100/60 text-blue-700 ring-1 ring-blue-200'
            : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
        }`}>
          {p.letter ?? '?'}
        </div>
      </div>

      <div className="mt-3">
        <FillBar pct={p.fillPct} current={p.totalQty} max={p.totalCapacity} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        <Tally label="Empty" n={p.empty} tone="slate" />
        <Tally label="Low" n={p.low} tone="amber" />
        <Tally label="Over" n={p.over} tone="red" />
        <Tally label="Stale" n={p.stale} tone="purple" />
      </div>
    </button>
  );
}

function Tally({ label, n, tone }: { label: string; n: number; tone: 'slate' | 'amber' | 'red' | 'purple' }) {
  if (n === 0) return null;
  const cls =
    tone === 'amber'  ? 'bg-amber-50 text-amber-800 ring-amber-200' :
    tone === 'red'    ? 'bg-red-50 text-red-700 ring-red-200' :
    tone === 'purple' ? 'bg-purple-50 text-purple-700 ring-purple-200' :
                        'bg-slate-50 text-slate-700 ring-slate-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${cls}`}>
      {label}
      <span className="tabular-nums">{n}</span>
    </span>
  );
}
