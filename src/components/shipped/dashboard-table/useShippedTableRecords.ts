'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEventBridge } from '@/hooks';
import { dashboardShippedQuery, dashboardShippedWeekQuery, SHIPPED_WEEK_PAGE_SIZE } from '@/lib/queries/dashboard-queries';
import { useShippedWeekBuckets } from './useShippedWeekBuckets';
import { getRecentWeekBuckets } from '@/lib/dashboard-week-range';
import { toPSTDateKey } from '@/utils/date';
import { useShippedSearch } from '@/hooks/useShippedSearch';
import { isStalled } from '@/components/shipping/ShipmentStatusBadge';
import {
  dedupeShippedRecords,
  deriveShippedRecord,
  isFbaPackerRecord,
  isSkuPackerRecord,
  hasLinkedOrder,
  isExceptionPackerRecord,
  type DerivedPackerRecord,
} from '@/lib/shipped-records';
import { toSearchResultRecord } from '@/components/shipped/shipped-record-mappers';
import type { PackerRecord } from '@/hooks/usePackerLogs';
import type { ShippedTableFilters } from './useShippedTableFilters';

/**
 * Fetches the shipped records (week query or search), runs the type +
 * carrier/status/exception/outbound filter pipeline, and attaches the derived
 * outbound state. Also wires the dashboard refresh events to query invalidation.
 *
 * Returns the raw `query` (for loading/fetching flags) alongside the fully
 * filtered, derived records that the grouping + view consume.
 */
export function useShippedTableRecords(filters: ShippedTableFilters) {
  const {
    effectiveWeekStart,
    effectiveWeekEnd,
    effPackedBy,
    effTestedBy,
    effStaffId,
    shippedFilter,
    shippedSearchField,
    search,
    normalizedSearch,
    exceptionsOnly,
    carrierFilter,
    statusFilter,
    obStatus,
    matchesOutbound,
  } = filters;

  const queryClient = useQueryClient();

  // Bucketed week cache: the visible window is fetched as canonical Mon–Sun week
  // buckets (stable, reused keys) so scrubbing a date range reads from cache and
  // only a never-seen week hits the DB; past weeks are immutable. The
  // carrier/status/exception filters fetch ALL-TIME (empty window) which can't be
  // week-bucketed, so that mode stays a single query.
  const allTimeMode = !effectiveWeekStart || !effectiveWeekEnd;

  // "Load more" paging: each step raises the per-week (and all-time) row ceiling
  // by one page. Reset to page 1 whenever the window / filters change so a new
  // view never inherits a stale expanded ceiling.
  const [pageMultiplier, setPageMultiplier] = useState(1);
  const fetchLimit = pageMultiplier * SHIPPED_WEEK_PAGE_SIZE;
  useEffect(() => {
    setPageMultiplier(1);
  }, [effectiveWeekStart, effectiveWeekEnd, effPackedBy, effTestedBy, effStaffId, shippedFilter, normalizedSearch]);
  const loadMore = useCallback(() => setPageMultiplier((m) => m + 1), []);

  const weekBuckets = useShippedWeekBuckets({
    rangeStart: effectiveWeekStart,
    rangeEnd: effectiveWeekEnd,
    packedBy: effPackedBy,
    testedBy: effTestedBy,
    staffId: effStaffId ?? undefined,
    shippedFilter,
    enabled: !normalizedSearch && !allTimeMode,
    limit: fetchLimit,
  });

  const allTimeQuery = useQuery({
    ...dashboardShippedQuery({
      weekStart: '',
      weekEnd: '',
      packedBy: effPackedBy,
      testedBy: effTestedBy,
      staffId: effStaffId ?? undefined,
      shippedFilter,
      limit: fetchLimit,
    }),
    enabled: !normalizedSearch && allTimeMode,
    placeholderData: (previousData) => previousData,
  });

  // Unified loading/fetching surface for the active source (the consumer only
  // reads these two flags).
  const query = {
    isLoading: allTimeMode ? allTimeQuery.isLoading : weekBuckets.isLoading,
    isFetching: allTimeMode ? allTimeQuery.isFetching : weekBuckets.isFetching,
  };

  // Warm the cache on idle so the common period presets (this/last week)
  // resolve INSTANTLY instead of cold-fetching on click. Prefetch shares the
  // week-query factory, so a warmed week is the exact entry the bucket query
  // later reads — past weeks fetch at most once per session.
  //
  // Scope: only the 2 most-recent weeks (this/last). The `/api/packerlogs`
  // query is lateral-heavy (~12 correlated subqueries per row), so each warmed
  // week is a real DB/Neon cost; warming 9 weeks on every dashboard mount was
  // ~7 extra cold queries a user rarely scrolls back to. Older weeks still warm
  // lazily on first navigation (and then cache at staleTime: Infinity).
  useEffect(() => {
    if (normalizedSearch) return undefined;
    const warm = () => {
      for (const { weekStart, weekEnd } of getRecentWeekBuckets(2)) {
        void queryClient.prefetchQuery(
          dashboardShippedWeekQuery({
            weekStart,
            weekEnd,
            packedBy: effPackedBy,
            testedBy: effTestedBy,
            staffId: effStaffId ?? undefined,
            shippedFilter,
          }),
        );
      }
    };
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(warm);
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 300);
    return () => window.clearTimeout(id);
  }, [normalizedSearch, effPackedBy, effTestedBy, effStaffId, shippedFilter, queryClient]);

  const searchResult = useShippedSearch({
    query: search,
    shippedFilter,
    searchField: shippedSearchField,
    packedBy: effPackedBy,
    testedBy: effTestedBy,
    staffId: effStaffId ?? undefined,
  });

  // Refresh events from form submits / cross-pane mutations → invalidate.
  useEventBridge({
    'usav-refresh-data': () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
    },
    'dashboard-refresh': () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
    },
  });

  const fetchedRecords = allTimeMode ? allTimeQuery.data ?? [] : weekBuckets.rows;

  // Clip the merged rows to the ACTIVE window — the selected week OR explicit
  // calendar range (both surface as effectiveWeekStart/End). The packerlogs week
  // query pads its scan window by ±1–2 days for timezone safety, so without this
  // clip the previous/next day leaks into a week view (the pill says "Jun 22–26"
  // but Jun 27–29 rows bleed in). Clipping by packed day hides everything outside
  // the selected period. All-time / carrier-filter mode (empty window) is left
  // unclipped on purpose — it is intentionally not date-scoped.
  const rawRecords = useMemo(() => {
    if (!effectiveWeekStart || !effectiveWeekEnd) return fetchedRecords;
    return fetchedRecords.filter((r) => {
      const src = r as { created_at?: string; effShipTime?: string };
      const key = toPSTDateKey(String(src.created_at || src.effShipTime || ''));
      return key !== '' && key >= effectiveWeekStart && key <= effectiveWeekEnd;
    });
  }, [fetchedRecords, effectiveWeekStart, effectiveWeekEnd]);
  const dedupedRecords = useMemo(() => dedupeShippedRecords(rawRecords), [rawRecords]);

  const typeFilteredRecords = useMemo(() =>
    shippedFilter === 'fba'
      ? dedupedRecords.filter(isFbaPackerRecord)
      : shippedFilter === 'orders'
        ? dedupedRecords.filter((r) => !isFbaPackerRecord(r) && (hasLinkedOrder(r) || isExceptionPackerRecord(r)))
        : shippedFilter === 'sku'
          ? dedupedRecords.filter(isSkuPackerRecord)
          : dedupedRecords.filter((r) => {
              if (isSkuPackerRecord(r)) return false;
              if (isFbaPackerRecord(r)) return true;
              return hasLinkedOrder(r) || isExceptionPackerRecord(r);
            }),
    [dedupedRecords, shippedFilter],
  );

  const carrierFilteredRecords = useMemo(() => {
    if (!exceptionsOnly && !carrierFilter && !statusFilter && !obStatus) return typeFilteredRecords;
    return typeFilteredRecords.filter((r) => {
      if (!matchesOutbound(r)) return false;
      if (carrierFilter && String(r.carrier ?? '').toUpperCase() !== carrierFilter) return false;
      if (statusFilter && String(r.latest_status_category ?? '').toUpperCase() !== statusFilter) return false;
      if (exceptionsOnly) {
        const hasEx = Boolean(r.has_exception);
        const stalled = isStalled({
          isTerminal: r.is_terminal ?? null,
          category: r.latest_status_category ?? null,
          latestEventAt: r.latest_event_at ?? null,
        });
        if (!hasEx && !stalled) return false;
      }
      return true;
    });
  }, [typeFilteredRecords, exceptionsOnly, carrierFilter, statusFilter, obStatus, matchesOutbound]);

  const searchRecords = useMemo<PackerRecord[]>(
    () => (searchResult.data?.records ?? []).map(toSearchResultRecord),
    [searchResult.data],
  );
  const searchFilteredRecords = useMemo(() => {
    if (!exceptionsOnly && !carrierFilter && !statusFilter && !obStatus) return searchRecords;
    return searchRecords.filter((r) => {
      if (!matchesOutbound(r)) return false;
      if (carrierFilter && String(r.carrier ?? '').toUpperCase() !== carrierFilter) return false;
      if (statusFilter && String(r.latest_status_category ?? '').toUpperCase() !== statusFilter) return false;
      if (exceptionsOnly) {
        const hasEx = Boolean(r.has_exception);
        const stalled = isStalled({
          isTerminal: r.is_terminal ?? null,
          category: r.latest_status_category ?? null,
          latestEventAt: r.latest_event_at ?? null,
        });
        if (!hasEx && !stalled) return false;
      }
      return true;
    });
  }, [searchRecords, exceptionsOnly, carrierFilter, statusFilter, obStatus, matchesOutbound]);

  const records = useMemo(
    () => (normalizedSearch ? searchFilteredRecords : carrierFilteredRecords),
    [normalizedSearch, searchFilteredRecords, carrierFilteredRecords],
  );

  // Attach the derived outbound state (packed-time vs left-warehouse-time) once,
  // so the grouped list and the scan-out sections read the same source of truth.
  const derivedRecords = useMemo<DerivedPackerRecord[]>(
    () => records.map(deriveShippedRecord),
    [records],
  );

  const searchMeta = searchResult.data?.meta ?? null;
  const isResolvingSearch = searchResult.isFetching && normalizedSearch.length > 0;

  // Truncation surfacing (non-search only): a week/all-time fetch that filled its
  // ceiling has more rows on the server. Expose it + a loader so the table can
  // offer an explicit "Load more" instead of silently dropping the older tail.
  const isTruncated = normalizedSearch
    ? false
    : allTimeMode
      ? (allTimeQuery.data?.length ?? 0) >= fetchLimit
      : weekBuckets.truncated;
  const pagination = {
    isTruncated,
    loadMore,
    isLoadingMore: query.isFetching && pageMultiplier > 1,
  };

  return { query, derivedRecords, searchMeta, isResolvingSearch, pagination };
}
