'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import { SearchBar } from '@/components/ui/SearchBar';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
import { Package, Truck, AlertTriangle, Clock, ChevronDown } from '@/components/Icons';
import { RECEIVING_HISTORY_URL_PARAMS } from '@/lib/receiving-history-search';
import {
  INCOMING_SORT_LABELS,
  type IncomingSort,
} from '@/components/sidebar/receiving/IncomingPaneHeader';

/** Facet bucket — mirrors the SQL CASE in /api/receiving-lines view=incoming. */
export type IncomingDeliveryState =
  | 'DELIVERED_UNOPENED'
  | 'ARRIVING_TODAY'
  | 'STALLED'
  | 'IN_TRANSIT'
  | 'AWAITING_TRACKING';

export interface IncomingSummary {
  issued: number;
  delivered_unopened: number;
  arriving_today: number;
  stalled: number;
  in_transit: number;
  awaiting_tracking: number;
  expected_today: number;
}

interface TileSpec {
  state: IncomingDeliveryState | null; // null = "All"
  label: string;
  key: keyof IncomingSummary;
  tone: 'rose' | 'amber' | 'blue' | 'gray' | 'slate' | 'orange';
  icon: React.FC<{ className?: string }>;
  /** Tooltip / `aria-description` — the *why* this bucket exists. */
  title: string;
}

const TILES: TileSpec[] = [
  {
    state: null,
    label: 'All issued',
    key: 'issued',
    tone: 'slate',
    icon: Package,
    title: 'Every PO Zoho says is issued and not yet received locally.',
  },
  {
    state: 'DELIVERED_UNOPENED',
    label: 'Delivered · not scanned',
    key: 'delivered_unopened',
    tone: 'rose',
    icon: AlertTriangle,
    title:
      'Carrier marked the box delivered AND no operator has scanned the tracking# at the receiving station yet (no receiving_scans row). Physically here, untouched — top priority.',
  },
  {
    state: 'ARRIVING_TODAY',
    label: 'Arriving today',
    key: 'arriving_today',
    tone: 'amber',
    icon: Truck,
    title: 'Carrier currently reports "out for delivery".',
  },
  {
    state: 'STALLED',
    label: 'Stalled',
    key: 'stalled',
    tone: 'orange',
    icon: AlertTriangle,
    title:
      'Carrier-reported exception OR no scan in >72h while still mid-route. Catch these before vendors do.',
  },
  {
    state: 'IN_TRANSIT',
    label: 'In transit',
    key: 'in_transit',
    tone: 'blue',
    icon: Truck,
    title: 'Label created, accepted, or in transit (carrier-side).',
  },
  {
    state: 'AWAITING_TRACKING',
    label: 'Awaiting tracking',
    key: 'awaiting_tracking',
    tone: 'gray',
    icon: Clock,
    title:
      'Zoho PO exists, no carrier signal yet — vendor may not have shipped or tracking# never landed.',
  },
];

/**
 * Per-tone token sets. Literal strings keep Tailwind's static extractor happy
 * (composing the class via `bg-${tone}-50` would be tree-shaken away in prod).
 */
const TONE: Record<
  TileSpec['tone'],
  { active: string; inactive: string; ring: string; iconActive: string; iconInactive: string }
> = {
  rose: {
    active: 'bg-rose-600 text-white ring-rose-600',
    inactive: 'bg-white text-rose-700 ring-rose-200 hover:bg-rose-50',
    ring: 'focus:ring-rose-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-rose-500',
  },
  amber: {
    active: 'bg-amber-600 text-white ring-amber-600',
    inactive: 'bg-white text-amber-800 ring-amber-200 hover:bg-amber-50',
    ring: 'focus:ring-amber-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-amber-500',
  },
  orange: {
    active: 'bg-orange-600 text-white ring-orange-600',
    inactive: 'bg-white text-orange-800 ring-orange-200 hover:bg-orange-50',
    ring: 'focus:ring-orange-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-orange-500',
  },
  blue: {
    active: 'bg-blue-600 text-white ring-blue-600',
    inactive: 'bg-white text-blue-700 ring-blue-200 hover:bg-blue-50',
    ring: 'focus:ring-blue-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-blue-500',
  },
  gray: {
    active: 'bg-gray-700 text-white ring-gray-700',
    inactive: 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50',
    ring: 'focus:ring-gray-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-gray-500',
  },
  slate: {
    active: 'bg-slate-900 text-white ring-slate-900',
    inactive: 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
    ring: 'focus:ring-slate-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-slate-500',
  },
};

/**
 * Incoming-mode sidebar — replaces the StationScanBar / Recent rail for
 * `?mode=incoming`. Self-contained: reads/writes the URL params it owns
 * (`q` for free-text search, `state` for the delivery_state facet) and
 * fetches its own aggregate-count endpoint. `ReceivingLinesTable` reads
 * the same URL params and refetches its row list when they change — no
 * prop-drilling, no shared state.
 *
 * Vertical layout (sidebar is ~280px wide):
 *   ┌────────────────────────┐
 *   │ [Search PO #, …      ] │
 *   ├────────────────────────┤
 *   │ INCOMING POS           │
 *   │ Issued: 554            │
 *   │ Expected today: 3      │
 *   ├────────────────────────┤
 *   │ [◉ All issued    554]  │
 *   │ [⚠  Delivered…    0]   │
 *   │ [🚚 Arriving today 0]  │
 *   │ [🚚 In transit    0]   │
 *   │ [⏰ Awaiting tr… 554]  │
 *   └────────────────────────┘
 */
export function IncomingSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const search = searchParams.get(RECEIVING_HISTORY_URL_PARAMS.q)?.trim() ?? '';
  const stateRaw = (searchParams.get('state') || '').trim().toUpperCase();
  const state: IncomingDeliveryState | null =
    stateRaw === 'DELIVERED_UNOPENED'
      || stateRaw === 'ARRIVING_TODAY'
      || stateRaw === 'STALLED'
      || stateRaw === 'IN_TRANSIT'
      || stateRaw === 'AWAITING_TRACKING'
      ? (stateRaw as IncomingDeliveryState)
      : null;

  const setSearch = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = next.trim();
      if (trimmed) params.set(RECEIVING_HISTORY_URL_PARAMS.q, trimmed);
      else params.delete(RECEIVING_HISTORY_URL_PARAMS.q);
      // Filter change invalidates the existing page index — otherwise the
      // right pane lands past the end of the new result set and shows empty.
      params.delete('page');
      router.replace(`/receiving?${params.toString()}`);
    },
    [router, searchParams],
  );

  const setState = useCallback(
    (next: IncomingDeliveryState | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set('state', next);
      else params.delete('state');
      params.delete('page');
      router.replace(`/receiving?${params.toString()}`);
    },
    [router, searchParams],
  );

  // ── PO purchase-date range filter ────────────────────────────────────────
  // URL keys `?po_from=YYYY-MM-DD&po_to=YYYY-MM-DD` map to the server
  // filter on `zoho_po_mirror.po_date` (Zoho's "PO date" field — when the
  // operator authored / issued the PO upstream). Parsed defensively so a
  // bookmark with one bad endpoint still renders.
  const parseISODate = (raw: string | null): Date | undefined => {
    if (!raw) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return undefined;
    const d = new Date(`${raw.trim()}T00:00:00`);
    return Number.isFinite(d.getTime()) ? d : undefined;
  };
  const poFrom = parseISODate(searchParams.get('po_from'));
  const poTo = parseISODate(searchParams.get('po_to'));
  const dateRange: DateRange | undefined = poFrom ? { from: poFrom, to: poTo } : undefined;

  const setDateRange = useCallback(
    (next: DateRange | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      const toISO = (d: Date | undefined) =>
        d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
      const from = toISO(next?.from);
      const to = toISO(next?.to);
      if (from) params.set('po_from', from);
      else params.delete('po_from');
      if (to) params.set('po_to', to);
      else params.delete('po_to');
      params.delete('page');
      router.replace(`/receiving?${params.toString()}`);
    },
    [router, searchParams],
  );

  // ── Sort axis ────────────────────────────────────────────────────────────
  // Lives in the sidebar now (was on the right-pane header). Same `?sort=`
  // URL contract the API reads, so other entry points (deep links, bookmarks)
  // stay valid. Default omits the param so the URL stays clean.
  const sortRaw = (searchParams.get('sort') || '').trim().toLowerCase();
  const sort: IncomingSort =
    sortRaw === 'zoho_oldest'
      ? 'zoho_oldest'
      : sortRaw === 'expected_soonest'
        ? 'expected_soonest'
        : sortRaw === 'recently_added'
          ? 'recently_added'
          : 'zoho_newest';
  const setSort = useCallback(
    (next: IncomingSort) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'zoho_newest') params.delete('sort');
      else params.set('sort', next);
      // Sort changes invalidate page numbering — drop ?page= so we land on 1.
      params.delete('page');
      router.replace(`/receiving?${params.toString()}`);
    },
    [router, searchParams],
  );

  // Polled aggregate. 30s cadence is the sweet spot: fresh enough that a
  // newly-delivered package surfaces between operator glances, cheap enough
  // that 100 concurrent operators each open a single query connection.
  const { data: summaryData } = useQuery<{ success: true } & IncomingSummary>({
    queryKey: ['receiving-lines-incoming-summary'],
    queryFn: async () => {
      const res = await fetch('/api/receiving-lines/incoming/summary', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('summary fetch failed');
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const summary: IncomingSummary | null = summaryData
    ? {
        issued: summaryData.issued,
        delivered_unopened: summaryData.delivered_unopened,
        arriving_today: summaryData.arriving_today,
        stalled: summaryData.stalled ?? 0,
        in_transit: summaryData.in_transit,
        awaiting_tracking: summaryData.awaiting_tracking,
        expected_today: summaryData.expected_today,
      }
    : null;

  const tiles = useMemo(
    () =>
      TILES.map((t) => {
        const active = state === t.state;
        const tone = TONE[t.tone];
        const count = summary ? (summary[t.key] as number) : null;
        const Icon = t.icon;
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => setState(active ? null : t.state)}
            title={t.title}
            aria-pressed={active}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 ${
              active ? tone.active : tone.inactive
            } ${tone.ring}`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${active ? tone.iconActive : tone.iconInactive}`} />
            <span className="flex-1 truncate">{t.label}</span>
            <span className="ml-1 tabular-nums text-caption font-black">
              {count == null ? '—' : count.toLocaleString()}
            </span>
          </button>
        );
      }),
    [summary, state, setState],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-gray-200 bg-white px-3 py-2">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search PO #, tracking, SKU…"
        />
        {/* PO purchase-date range filter. Maps to `zoho_po_mirror.po_date`
            via `?po_from=` / `?po_to=` URL params; the list endpoint
            narrows incoming rows server-side. */}
        <DateRangePickerField
          value={dateRange}
          onChange={setDateRange}
          placeholder="PO purchased between…"
        />
        {/* Sort axis — used to live in the right-pane header; moved here so
            the right pane can host pagination without competing controls. */}
        <div>
          <label className="flex items-center justify-between gap-2 text-eyebrow font-black uppercase tracking-wider text-gray-500">
            <span className="shrink-0">Sort</span>
            <div className="relative flex-1">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as IncomingSort)}
                className="h-8 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                aria-label="Sort incoming POs by"
              >
                {(Object.keys(INCOMING_SORT_LABELS) as IncomingSort[]).map((k) => (
                  <option key={k} value={k}>
                    {INCOMING_SORT_LABELS[k]}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            </div>
          </label>
          <p className="mt-1 text-eyebrow font-medium text-gray-400">
            Date in header = when Zoho PO was created
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3">{tiles}</div>
    </div>
  );
}
