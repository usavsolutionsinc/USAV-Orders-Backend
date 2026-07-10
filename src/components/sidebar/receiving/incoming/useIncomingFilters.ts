'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { DateRange } from 'react-day-picker';
import { receivingSurfaceBasePath } from '@/lib/receiving/surface-path';
import type { FilterRefinement } from '@/design-system/components/FilterRefinementBar';
import { RECEIVING_HISTORY_URL_PARAMS } from '@/lib/receiving-history-search';
import type { IncomingSort } from '@/components/sidebar/receiving/IncomingPaneHeader';
import { TILES, TONE } from './incoming-tiles';
import type { IncomingDeliveryState } from './incoming-summary-types';

const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseISODate = (raw: string | null): Date | undefined => {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return undefined;
  const d = new Date(`${raw.trim()}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : undefined;
};

/**
 * URL-param filter state for the Incoming sidebar (`?q`, `?state`, `?sort`,
 * `?po_from/po_to`). Self-contained: reads/writes `/receiving?…` so
 * ReceivingLinesTable refetches off the same params — no prop-drilling. Every
 * filter change drops `?page=` so the right pane lands on page 1.
 */
export function useIncomingFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Stay on the current surface (`/incoming` once graduated, else `/receiving`).
  const base = receivingSurfaceBasePath(pathname);

  const search = searchParams.get(RECEIVING_HISTORY_URL_PARAMS.q)?.trim() ?? '';
  const stateRaw = (searchParams.get('state') || '').trim().toUpperCase();
  const state: IncomingDeliveryState | null =
    stateRaw === 'DELIVERED_UNOPENED'
      || stateRaw === 'DELIVERED_NOT_UNBOXED'
      || stateRaw === 'DELIVERED_EMAIL'
      || stateRaw === 'ARRIVING_TODAY'
      || stateRaw === 'STALLED'
      || stateRaw === 'IN_TRANSIT'
      || stateRaw === 'TRACKING_UNAVAILABLE'
      || stateRaw === 'PENDING_CARRIER'
      || stateRaw === 'CARRIER_MISMATCH'
      || stateRaw === 'AWAITING_TRACKING'
      || stateRaw === 'WRONG_DESTINATION'
      ? (stateRaw as IncomingDeliveryState)
      : null;

  const setSearch = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = next.trim();
      if (trimmed) params.set(RECEIVING_HISTORY_URL_PARAMS.q, trimmed);
      else params.delete(RECEIVING_HISTORY_URL_PARAMS.q);
      params.delete('page');
      router.replace(`${base}?${params.toString()}`);
    },
    [router, searchParams, base],
  );

  const setState = useCallback(
    (next: IncomingDeliveryState | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set('state', next);
      else params.delete('state');
      params.delete('page');
      router.replace(`${base}?${params.toString()}`);
    },
    [router, searchParams, base],
  );

  // PO purchase-date range — `?po_from/po_to` map to zoho_po_mirror.po_date.
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
      router.replace(`${base}?${params.toString()}`);
    },
    [router, searchParams, base],
  );

  // Sort axis — same `?sort=` URL contract the API reads. Default omits the param.
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
      params.delete('page');
      router.replace(`${base}?${params.toString()}`);
    },
    [router, searchParams, base],
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('state');
    params.delete('po_from');
    params.delete('po_to');
    params.delete('page');
    const s = params.toString();
    router.replace(s ? `${base}?${s}` : base);
  }, [router, searchParams, base]);

  const activeTile = state ? TILES.find((t) => t.state === state) ?? null : null;

  const refinements = useMemo((): FilterRefinement[] => {
    const out: FilterRefinement[] = [];
    if (activeTile) {
      out.push({ id: 'state', label: activeTile.label, onRemove: () => setState(null), pillClassName: TONE[activeTile.tone].pill });
    }
    if (poFrom || poTo) {
      const from = poFrom ? toISODate(poFrom) : null;
      const to = poTo ? toISODate(poTo) : null;
      const range = from && to && to !== from ? `${from} → ${to}` : from ?? to ?? '';
      out.push({ id: 'date', label: `PO ${range}`, onRemove: () => setDateRange(undefined) });
    }
    return out;
  }, [activeTile, poFrom, poTo, setState, setDateRange]);

  return {
    search, setSearch,
    state, setState,
    sort, setSort,
    dateRange, setDateRange,
    poFrom, poTo,
    clearFilters,
    activeTile,
    refinements,
    activeFilterCount: refinements.length,
  };
}
