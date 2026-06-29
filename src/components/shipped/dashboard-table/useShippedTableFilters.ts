'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { normalizeShippedSearchField } from '@/lib/shipped-search';
import {
  readShippedFilterPreference,
  writeShippedFilterPreference,
} from '@/utils/dashboard-preferences';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import {
  readShippedCarrierFilter,
  readShippedExceptionsFilter,
  readShippedStatusFilter,
} from '@/components/shipping/ShippedFilterToolbar';
import { deriveShippedRecord } from '@/lib/shipped-records';
import type { PackerRecord } from '@/hooks/usePackerLogs';

export type ShippedTypeFilter = 'all' | 'orders' | 'sku' | 'fba';

/** Right-pane presentation of the same week-scoped record set:
 *  `board` = outbound-state swimlanes (default), `all` = flat chronological list. */
export type ShippedLayout = 'board' | 'all';

export interface UseShippedTableFiltersOptions {
  packedBy?: number;
  testedBy?: number;
}

/**
 * Derives every filter / week / staff / search value the shipped table reads
 * from the URL search params (plus the persisted type-filter preference), and
 * exposes the URL mutators that write them back. Keeping this in one hook means
 * the table body never touches `searchParams` directly.
 */
export function useShippedTableFilters({ packedBy, testedBy }: UseShippedTableFiltersOptions) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const shippedSearchField = normalizeShippedSearchField(searchParams.get('shippedSearchField'));

  const shippedFilterParam = searchParams.get('shippedFilter');
  const shippedFilter = useMemo<ShippedTypeFilter>(() => {
    if (shippedFilterParam === 'orders' || shippedFilterParam === 'sku' || shippedFilterParam === 'fba') {
      return shippedFilterParam;
    }
    if (shippedFilterParam === 'all') return 'all';
    return readShippedFilterPreference() ?? 'all';
  }, [shippedFilterParam]);

  const weekOffsetParam = searchParams.get('shippedWeekOffset');
  const weekOffset = useMemo(() => {
    if (weekOffsetParam != null) {
      return Math.max(0, Number.parseInt(weekOffsetParam || '0', 10) || 0);
    }
    return 0;
  }, [weekOffsetParam]);
  const weekRange = getWeekRangeForOffset(weekOffset);

  const exceptionsOnly = readShippedExceptionsFilter(searchParams);
  const carrierFilter = readShippedCarrierFilter(searchParams);
  const statusFilter = readShippedStatusFilter(searchParams);
  // Click-to-filter from the outbound status legend (`?ostatus`). Narrows the
  // already-loaded week records by exact derived state — week-scoped, so it
  // stays in lockstep with the legend's week counts (no all-time widening).
  // The Exception chip folds PROCESS_GAP (same bucket the legend renders).
  const obStatus = String(searchParams.get('ostatus') || '').trim().toUpperCase();
  const matchesOutbound = useCallback(
    (r: PackerRecord): boolean => {
      if (!obStatus) return true;
      const s = deriveShippedRecord(r).outboundState;
      return obStatus === 'EXCEPTION' ? s === 'EXCEPTION' || s === 'PROCESS_GAP' : s === obStatus;
    },
    [obStatus],
  );

  const parseStaffParam = (raw: string | null): number | undefined => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const effPackedBy = packedBy ?? parseStaffParam(searchParams.get('packedBy'));
  const effTestedBy = testedBy ?? parseStaffParam(searchParams.get('testedBy'));
  // Universal staff filter (P1-WORK-02): one `?staff=` → packed OR tested by.
  const effStaffId = parseStaffParam(searchParams.get('staff'));

  const dateFrom = (searchParams.get('dateFrom') || '').trim();
  const dateTo = (searchParams.get('dateTo') || '').trim();
  const hasDateRange =
    /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo);

  const anyCarrierFilter = exceptionsOnly || !!carrierFilter || !!statusFilter;
  const effectiveWeekStart = hasDateRange ? dateFrom : anyCarrierFilter ? '' : weekRange.startStr;
  const effectiveWeekEnd = hasDateRange ? dateTo : anyCarrierFilter ? '' : weekRange.endStr;

  const search = searchParams.get('search') || '';
  const normalizedSearch = search.trim().toLowerCase();

  // Presentation lens over the same records — URL-backed so a shared `?layout=board`
  // link (and a reload) reproduce the exact view. Default `all` drops out of the URL.
  const layout: ShippedLayout = searchParams.get('layout') === 'board' ? 'board' : 'all';

  // Mirror the active type filter into the persisted preference.
  useEffect(() => {
    writeShippedFilterPreference(
      shippedFilter === 'orders' || shippedFilter === 'sku' || shippedFilter === 'fba' ? shippedFilter : 'all',
    );
  }, [shippedFilter]);

  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const nextSearch = params.toString();
      const nextPath = pathname || '/dashboard';
      const nextUrl = nextSearch ? `${nextPath}?${nextSearch}` : nextPath;
      // Use the History API (Next integrates it with `useSearchParams`) rather
      // than `router.replace`. These are client-only filter changes on a fully
      // client-rendered page; `router.replace` does a soft RSC navigation (a
      // server round-trip) that makes every date change wait seconds — the
      // "slow to update" symptom. `history.replaceState` updates the URL +
      // `useSearchParams` instantly with no server fetch.
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', nextUrl);
      } else {
        router.replace(nextUrl, { scroll: false });
      }
    },
    [pathname, router, searchParams],
  );

  const setWeekOffset = useCallback(
    (nextOffset: number) => {
      replaceParams((params) => {
        if (nextOffset <= 0) params.delete('shippedWeekOffset');
        else params.set('shippedWeekOffset', String(nextOffset));
      });
    },
    [replaceParams],
  );

  const clearSearch = useCallback(() => {
    replaceParams((params) => { params.delete('search'); });
  }, [replaceParams]);

  const applyShippedFilter = useCallback(
    (filter: string) => {
      replaceParams((params) => { params.set('shippedFilter', filter); });
    },
    [replaceParams],
  );

  const setLayout = useCallback(
    (next: ShippedLayout) => {
      replaceParams((params) => {
        if (next === 'all') params.delete('layout');
        else params.set('layout', next);
      });
    },
    [replaceParams],
  );

  // Period selectors for the date picker. Each is ONE atomic URL write (week and
  // explicit-range params are mutually exclusive, so every setter clears the
  // other axis) — never chain setWeekOffset + a range setter, they'd each build
  // from the same stale params snapshot and clobber one another.
  const setPeriodWeek = useCallback(
    (offset: number) => {
      replaceParams((params) => {
        params.delete('dateFrom');
        params.delete('dateTo');
        if (offset <= 0) params.delete('shippedWeekOffset');
        else params.set('shippedWeekOffset', String(offset));
      });
    },
    [replaceParams],
  );

  const setPeriodRange = useCallback(
    (from: string, to: string) => {
      replaceParams((params) => {
        params.delete('shippedWeekOffset');
        params.set('dateFrom', from);
        params.set('dateTo', to);
      });
    },
    [replaceParams],
  );

  const clearPeriod = useCallback(() => {
    replaceParams((params) => {
      params.delete('dateFrom');
      params.delete('dateTo');
      params.delete('shippedWeekOffset');
    });
  }, [replaceParams]);

  return {
    shippedSearchField,
    shippedFilter,
    weekOffset,
    weekRange,
    exceptionsOnly,
    carrierFilter,
    statusFilter,
    obStatus,
    matchesOutbound,
    effPackedBy,
    effTestedBy,
    effStaffId,
    dateFrom,
    dateTo,
    hasDateRange,
    anyCarrierFilter,
    effectiveWeekStart,
    effectiveWeekEnd,
    search,
    normalizedSearch,
    layout,
    setWeekOffset,
    clearSearch,
    applyShippedFilter,
    setLayout,
    setPeriodWeek,
    setPeriodRange,
    clearPeriod,
  };
}

export type ShippedTableFilters = ReturnType<typeof useShippedTableFilters>;
