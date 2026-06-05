'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
import { Package, Truck, AlertTriangle, Clock, ChevronDown, RefreshCw, Filter } from '@/components/Icons';
import { toast } from '@/lib/toast';
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
  | 'TRACKING_UNAVAILABLE'
  | 'PENDING_CARRIER'
  | 'AWAITING_TRACKING';

export interface IncomingCarrierBreakdown {
  carrier: 'UPS' | 'USPS' | 'FEDEX' | string;
  delivered_unscanned: number;
  tracking_unavailable: number;
  in_transit: number;
}

export interface IncomingSummary {
  issued: number;
  delivered_unopened: number;
  arriving_today: number;
  stalled: number;
  in_transit: number;
  pending_carrier: number;
  tracking_unavailable: number;
  awaiting_tracking: number;
  expected_today: number;
  by_carrier?: IncomingCarrierBreakdown[];
}

interface TileSpec {
  state: IncomingDeliveryState | null; // null = "All"
  label: string;
  key: keyof IncomingSummary;
  tone: 'rose' | 'amber' | 'blue' | 'gray' | 'slate' | 'orange' | 'violet';
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
    state: 'PENDING_CARRIER',
    label: 'Pending carrier',
    key: 'pending_carrier',
    tone: 'gray',
    icon: Clock,
    title:
      'Tracking# is registered with a known carrier, but the carrier sync has not returned a status yet (UNKNOWN / NULL). USPS shipments often land here while the sync adapter is rate-limited.',
  },
  {
    state: 'TRACKING_UNAVAILABLE',
    label: 'Tracking unavailable',
    key: 'tracking_unavailable',
    tone: 'violet',
    icon: AlertTriangle,
    title:
      'The carrier is refusing tracking requests for these (e.g. USPS access-control 403 while the IP Agreement is pending). Delivered status is unobtainable until access clears — not "not delivered".',
  },
  {
    state: 'AWAITING_TRACKING',
    label: 'Awaiting tracking #',
    key: 'awaiting_tracking',
    tone: 'gray',
    icon: Clock,
    title:
      'No tracking# registered at all — vendor has not shipped, or the PO `reference_number` field on Zoho is empty.',
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
  violet: {
    active: 'bg-violet-600 text-white ring-violet-600',
    inactive: 'bg-white text-violet-700 ring-violet-200 hover:bg-violet-50',
    ring: 'focus:ring-violet-500/40',
    iconActive: 'text-white',
    iconInactive: 'text-violet-500',
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
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [reloading, setReloading] = useState(false);

  // The three query keys this view (tiles + row list + delivered-unscanned
  // facet) reads from. Both refresh actions invalidate exactly these.
  const invalidateIncoming = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-incoming-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] }),
      queryClient.invalidateQueries({ queryKey: ['incoming-delivered-unscanned'] }),
    ]);
  }, [queryClient]);

  // Cheap "update the display" — re-reads the DB (tiles + rows) WITHOUT calling
  // any carrier API. This is what reflects cron-poll changes that already landed
  // server-side; instant and free, so it can be hit liberally.
  const refreshData = useCallback(async () => {
    if (reloading) return;
    setReloading(true);
    try {
      await invalidateIncoming();
      toast.success('Display updated');
    } finally {
      // Brief spin so the action reads as "did something" even when instant.
      setTimeout(() => setReloading(false), 350);
    }
  }, [reloading, invalidateIncoming]);

  // Single-filter popover (mirrors the dashboard's ShippedCarrierFilters):
  // every refinement — the delivery-state facet, the PO date range, and the
  // sort axis — lives behind one button below the search bar.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        // Clicks inside a portaled Radix popper (the date calendar) aren't "outside".
        if (target.closest?.('[data-radix-popper-content-wrapper]')) return;
        setFiltersOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  // Re-poll carrier tracking for the incoming set, then refetch the tiles +
  // row list so just-delivered packages stop showing a stale transit status.
  const refreshTracking = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch('/api/receiving-lines/incoming/refresh', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        toast.error(data?.error || `Refresh failed (${res.status})`);
        return;
      }
      await invalidateIncoming();
      if (data.throttled) {
        toast.success('Just refreshed — showing the latest tracking');
      } else {
        const parts = [`${data.scanned ?? 0} polled`];
        if (data.delivered) parts.push(`${data.delivered} delivered`);
        if (data.errors) parts.push(`${data.errors} errors`);
        toast.success(`Tracking refreshed · ${parts.join(' · ')}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, invalidateIncoming]);

  const search = searchParams.get(RECEIVING_HISTORY_URL_PARAMS.q)?.trim() ?? '';
  const stateRaw = (searchParams.get('state') || '').trim().toUpperCase();
  const state: IncomingDeliveryState | null =
    stateRaw === 'DELIVERED_UNOPENED'
      || stateRaw === 'ARRIVING_TODAY'
      || stateRaw === 'STALLED'
      || stateRaw === 'IN_TRANSIT'
      || stateRaw === 'TRACKING_UNAVAILABLE'
      || stateRaw === 'PENDING_CARRIER'
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
        pending_carrier: summaryData.pending_carrier ?? 0,
        tracking_unavailable: summaryData.tracking_unavailable ?? 0,
        awaiting_tracking: summaryData.awaiting_tracking,
        expected_today: summaryData.expected_today,
        by_carrier: summaryData.by_carrier,
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

  // Filter button summary: the selected delivery-state facet + an active PO
  // date range each count as one refinement (sort is an ordering, not a filter).
  const activeTile = state ? TILES.find((t) => t.state === state) ?? null : null;
  const activeFilterCount = (state ? 1 : 0) + (poFrom ? 1 : 0);

  return (
    // overflow-visible so the filter popover (absolute) isn't clipped — this
    // panel has no scroll body, only the search + filter/refresh controls.
    <SidebarShell
      className="overflow-visible"
      search={{ value: search, onChange: setSearch, placeholder: 'Search PO #, tracking, SKU…' }}
      headerBelow={
        <div className="space-y-2 border-b border-gray-200 bg-white pb-2">
        {/* Two-action refresh row, ABOVE the Filters button so the (absolute,
            downward) filter popover never overlays it:
              • Refresh — re-reads the DB (tiles + rows) only; reflects changes
                the carrier-poll cron already landed. Instant, no carrier calls.
              • Sync carriers — re-polls UPS/USPS/FedEx for every active tracking
                number, then re-reads. Slower; rate-limited server-side. */}
        <div className="flex items-stretch gap-1.5 px-1.5">
          <button
            type="button"
            onClick={() => void refreshData()}
            disabled={reloading}
            title="Re-read the latest incoming data (no carrier calls)"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-caption font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} />
            {reloading ? 'Updating…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => void refreshTracking()}
            disabled={refreshing}
            title="Re-poll UPS / USPS / FedEx for all active tracking numbers, then refresh"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-caption font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Truck className={`h-3.5 w-3.5 ${refreshing ? 'animate-pulse' : ''}`} />
            {refreshing ? 'Syncing…' : 'Sync carriers'}
          </button>
        </div>

        {/* Single filter entry point — the delivery-state facet, PO purchase
            date range, and sort axis all condense into one popover below the
            search bar (mirrors the dashboard's ShippedCarrierFilters). */}
        <div className="relative px-1.5" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
              activeFilterCount > 0
                ? 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100'
                : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate text-left">
              {activeTile ? activeTile.label : 'Filters'}
            </span>
            {activeFilterCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-mini font-black text-white">
                {activeFilterCount}
              </span>
            ) : null}
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>

          {filtersOpen ? (
            <div
              role="dialog"
              aria-label="Incoming filters"
              className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-[70vh] space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5"
            >
              {/* Delivery-state facet — the old vertical tile stack, now grouped. */}
              <div>
                <span className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                  Status
                </span>
                <div className="space-y-1.5">{tiles}</div>
              </div>

              {/* E4 per-carrier breakdown — at-a-glance "USPS: 12 unavailable,
                  FedEx: 3 delivered-unscanned" so the team can see which carrier
                  is driving the actionable buckets. Only the non-zero columns. */}
              {summary?.by_carrier?.some(
                (c) => c.delivered_unscanned || c.tracking_unavailable || c.in_transit,
              ) ? (
                <div>
                  <span className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                    By carrier
                  </span>
                  <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-gray-200">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 bg-gray-50 px-2 py-1 text-mini font-black uppercase tracking-wide text-gray-400">
                      <span>Carrier</span>
                      <span className="text-right" title="Delivered · not scanned">Deliv</span>
                      <span className="text-right" title="Tracking unavailable">Unav</span>
                      <span className="text-right" title="In transit">Trans</span>
                    </div>
                    {summary.by_carrier!.map((c) => (
                      <div
                        key={c.carrier}
                        className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 border-t border-gray-100 px-2 py-1 text-caption"
                      >
                        <span className="font-bold text-gray-700">{c.carrier}</span>
                        <span className={`text-right font-bold tabular-nums ${c.delivered_unscanned ? 'text-rose-600' : 'text-gray-300'}`}>
                          {c.delivered_unscanned}
                        </span>
                        <span className={`text-right font-bold tabular-nums ${c.tracking_unavailable ? 'text-violet-600' : 'text-gray-300'}`}>
                          {c.tracking_unavailable}
                        </span>
                        <span className={`text-right font-bold tabular-nums ${c.in_transit ? 'text-blue-600' : 'text-gray-300'}`}>
                          {c.in_transit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* PO purchase-date range — maps to `zoho_po_mirror.po_date` via
                  `?po_from=` / `?po_to=`; the list endpoint narrows server-side. */}
              <div>
                <span className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                  PO purchased between
                </span>
                <DateRangePickerField
                  value={dateRange}
                  onChange={setDateRange}
                  placeholder="Any date"
                />
                <p className="mt-1 text-eyebrow font-medium text-gray-400">
                  Date in header = when Zoho PO was created
                </p>
              </div>

              {/* Sort axis — same `?sort=` URL contract the API + header read. */}
              <label className="block">
                <span className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                  Sort
                </span>
                <div className="relative">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as IncomingSort)}
                    className="h-9 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    aria-label="Sort incoming POs by"
                  >
                    {(Object.keys(INCOMING_SORT_LABELS) as IncomingSort[]).map((k) => (
                      <option key={k} value={k}>
                        {INCOMING_SORT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                </div>
              </label>

              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setState(null);
                    setDateRange(undefined);
                  }}
                  className="w-full text-center text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        </div>
      }
    />
  );
}
