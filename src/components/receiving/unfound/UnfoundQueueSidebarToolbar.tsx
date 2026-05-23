'use client';

/**
 * Sidebar toolbar for the Unfound queue.
 *
 * Renders the filter pills (kind), "Show checked" toggle, search box, and
 * Refresh button. Writes filter state to URL search params (uf_kind,
 * uf_checked, uf_q) so UnfoundQueueTable — which reads the same params —
 * stays in lockstep without a shared store.
 *
 * Refresh dispatches a `unfound-queue-refresh` window event the table
 * listens for. Keeps the toolbar decoupled from the table's fetch hook.
 */

import { useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw, Search } from '@/components/Icons';
import {
  ENABLED_KINDS,
  KIND_LABELS,
  type QueueKind,
} from '@/components/receiving/unfound/UnfoundQueueTable';

const UNFOUND_QUEUE_REFRESH_EVENT = 'unfound-queue-refresh';
const SEARCH_DEBOUNCE_MS = 300;

function parseKind(raw: string | null): QueueKind {
  if (!raw) return 'all';
  return (ENABLED_KINDS as readonly string[]).includes(raw)
    ? (raw as QueueKind)
    : 'all';
}

export function UnfoundQueueSidebarToolbar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const kind = parseKind(searchParams.get('uf_kind'));
  const showChecked = searchParams.get('uf_checked') === '1';
  const q = searchParams.get('uf_q') ?? '';

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Write a single param (or delete it when empty). All three filters live
  // under `uf_*` so they don't collide with the receiving page's own params.
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
      router.replace(`/receiving/unfound?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const onKind = useCallback(
    (next: QueueKind) => setParam('uf_kind', next === 'all' ? null : next),
    [setParam],
  );

  const onChecked = useCallback(
    (checked: boolean) => setParam('uf_checked', checked ? '1' : null),
    [setParam],
  );

  const onSearch = useCallback(
    (raw: string) => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      // Debounce so we don't push a new history entry on every keystroke.
      searchDebounceRef.current = setTimeout(() => {
        setParam('uf_q', raw.trim() || null);
      }, SEARCH_DEBOUNCE_MS);
    },
    [setParam],
  );

  const onRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent(UNFOUND_QUEUE_REFRESH_EVENT));
  }, []);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Title + Refresh */}
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-bold tracking-tight text-gray-900">
          Unfound queue
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh"
          className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          defaultValue={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search title, serial, note, ticket…"
          className="h-8 w-full rounded-md border border-gray-200 bg-white pl-7 pr-3 text-[12px] outline-none focus:border-blue-500"
        />
      </div>

      {/* Kind filter pills — stacked one per row to fit the narrow sidebar */}
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Source
        </p>
        {ENABLED_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onKind(k)}
            className={`rounded-md px-2.5 py-1.5 text-left text-[12px] font-semibold transition-colors ${
              kind === k
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {/* Show-checked toggle */}
      <label className="flex items-center gap-1.5 text-[12px] text-gray-700">
        <input
          type="checkbox"
          checked={showChecked}
          onChange={(e) => onChecked(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Show checked
      </label>
    </div>
  );
}
