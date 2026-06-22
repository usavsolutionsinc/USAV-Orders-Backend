'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEventBridge } from '@/hooks';
import { dashboardShippedQuery } from '@/lib/queries/dashboard-queries';
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

  const query = useQuery({
    ...dashboardShippedQuery({
      weekStart: effectiveWeekStart,
      weekEnd: effectiveWeekEnd,
      packedBy: effPackedBy,
      testedBy: effTestedBy,
      staffId: effStaffId ?? undefined,
      shippedFilter,
    }),
    enabled: !normalizedSearch,
    placeholderData: (previousData) => previousData,
  });

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

  const rawRecords = useMemo(() => query.data || [], [query.data]);
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
