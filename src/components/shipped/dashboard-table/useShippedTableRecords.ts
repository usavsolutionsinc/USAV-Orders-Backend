'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEventBridge } from '@/hooks';
import { dashboardShippedQuery, dashboardShippedWeekQuery } from '@/lib/queries/dashboard-queries';
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
    hasDateRange,
    dateFrom,
    dateTo,
  } = filters;

  const queryClient = useQueryClient();

  // Bucketed week cache: the visible window is fetched as canonical Mon–Sun week
  // buckets (stable, reused keys) so scrubbing a date range reads from cache and
  // only a never-seen week hits the DB; past weeks are immutable. The
  // carrier/status/exception filters fetch ALL-TIME (empty window) which can't be
  // week-bucketed, so that mode stays a single query.
  const allTimeMode = !effectiveWeekStart || !effectiveWeekEnd;

  const weekBuckets = useShippedWeekBuckets({
    rangeStart: effectiveWeekStart,
    rangeEnd: effectiveWeekEnd,
    packedBy: effPackedBy,
    testedBy: effTestedBy,
    staffId: effStaffId ?? undefined,
    shippedFilter,
    enabled: !normalizedSearch && !allTimeMode,
  });

  const allTimeQuery = useQuery({
    ...dashboardShippedQuery({
      weekStart: '',
      weekEnd: '',
      packedBy: effPackedBy,
      testedBy: effTestedBy,
      staffId: effStaffId ?? undefined,
      shippedFilter,
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

  // Warm the cache on idle so the common period presets (this/last week,
  // this/last month) resolve INSTANTLY instead of cold-fetching on click.
  // Prefetch shares the week-query factory, so a warmed week is the exact entry
  // the bucket query later reads — past weeks fetch at most once per session.
  useEffect(() => {
    if (normalizedSearch) return undefined;
    const warm = () => {
      for (const { weekStart, weekEnd } of getRecentWeekBuckets(9)) {
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

  // Week buckets fetch whole Mon–Sun weeks; when the user picked an explicit
  // range, clip the merged rows to exactly [dateFrom, dateTo] by packed day.
  // Plain week navigation shows the full week bucket (no clip).
  const rawRecords = useMemo(() => {
    if (!hasDateRange) return fetchedRecords;
    return fetchedRecords.filter((r) => {
      const key = toPSTDateKey(String((r as { created_at?: string }).created_at ?? ''));
      return key !== '' && key >= dateFrom && key <= dateTo;
    });
  }, [fetchedRecords, hasDateRange, dateFrom, dateTo]);
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

  return { query, derivedRecords, searchMeta, isResolvingSearch };
}
