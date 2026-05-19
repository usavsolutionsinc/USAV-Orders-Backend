'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X } from '@/components/Icons';
import { dispatchReceivingDetailsOverlay } from '@/utils/events';
import {
  clearReceivingSearchHistory,
  RECEIVING_SEARCH_HISTORY_EVENT,
  readReceivingSearchHistory,
  type ReceivingSearchEntry,
} from '@/utils/receiving-search-history';

function relativeTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  const ms = Date.now() - ts;
  if (ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function last4(s: string): string {
  if (!s) return '';
  return s.length <= 4 ? s : s.slice(-4);
}

/**
 * History-mode sidebar rail: localStorage-backed list of recent tracking
 * searches. Clicking an entry opens `ReceivingDetailsStack` directly via the
 * cached `receivingId` — no API roundtrip, no second search.
 *
 * Mirrors `ReceivingRecentRail` visually so the operator's spatial muscle
 * memory carries between Receive (activity) and History (searches), but with
 * an indigo accent + Search iconography to signal the different data model.
 */
export function RecentSearchesRail() {
  const [entries, setEntries] = useState<ReceivingSearchEntry[]>([]);

  const refresh = useCallback(() => {
    setEntries(readReceivingSearchHistory());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(RECEIVING_SEARCH_HISTORY_EVENT, refresh);
    // Cross-tab sync via the native `storage` event.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.includes('receiving.recent-searches')) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(RECEIVING_SEARCH_HISTORY_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  return (
    <section className="border-t border-indigo-100 bg-gradient-to-b from-indigo-50/30 to-white">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-indigo-700">
          <Search className="h-3 w-3" />
          Recent searches · {entries.length}
        </p>
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={clearReceivingSearchHistory}
            className="text-[8.5px] font-bold uppercase tracking-widest text-indigo-400 hover:text-indigo-700"
          >
            Clear
          </button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <div className="px-3 py-3">
          <div className="rounded-lg border border-dashed border-indigo-200 bg-white px-3 py-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">
              No searches yet
            </p>
            <p className="mt-1 text-[10px] font-semibold leading-snug text-gray-500">
              Search above by tracking number or PO #.
            </p>
          </div>
        </div>
      ) : (
        <ul className="px-2 py-1">
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <SearchRailRow key={`${entry.tracking}-${entry.at}`} entry={entry} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function SearchRailRow({ entry }: { entry: ReceivingSearchEntry }) {
  const truncatedTracking =
    entry.tracking.length > 18 ? `${entry.tracking.slice(0, 4)}…${last4(entry.tracking)}` : entry.tracking;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        type="button"
        onClick={() => dispatchReceivingDetailsOverlay(entry.receivingId)}
        className="group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-indigo-50/60"
        title={`Tracking ${entry.tracking} · Receiving #${entry.receivingId}`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-indigo-400"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] font-bold text-gray-900">
            {truncatedTracking}
          </p>
          <p className="truncate text-[9px] font-semibold uppercase tracking-widest text-gray-500">
            <span className="text-indigo-600">#{entry.receivingId}</span>
            {' · '}
            <span>{entry.lineCount} {entry.lineCount === 1 ? 'line' : 'lines'}</span>
          </p>
        </div>
        <span className="shrink-0 tabular-nums text-[9px] font-bold text-gray-400">
          {relativeTime(entry.at)}
        </span>
        <X className="invisible h-3 w-3 shrink-0 text-gray-300 group-hover:visible" aria-hidden />
      </button>
    </motion.li>
  );
}
