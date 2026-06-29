'use client';

import { useQueries } from '@tanstack/react-query';
import { dashboardShippedWeekQuery } from '@/lib/queries/dashboard-queries';
import { getWeekBucketsForRange } from '@/lib/dashboard-week-range';
import type { PackerRecord } from '@/hooks/usePackerLogs';
import type { ShippedTypeFilter } from './useShippedTableFilters';

export interface UseShippedWeekBucketsParams {
  /** Effective window start (YYYY-MM-DD). */
  rangeStart: string;
  /** Effective window end (YYYY-MM-DD). */
  rangeEnd: string;
  packedBy?: number;
  testedBy?: number;
  staffId?: number;
  shippedFilter: ShippedTypeFilter;
  /** False while searching / in all-time carrier-filter mode (no bucketing). */
  enabled: boolean;
}

export interface ShippedWeekBucketsResult {
  rows: PackerRecord[];
  isLoading: boolean;
  isFetching: boolean;
}

/**
 * Fetches the shipped window as canonical Mon–Sun week buckets and merges them.
 *
 * Each bucket is its own React Query entry keyed by the week (not the user's
 * arbitrary range), so scrubbing a date range reuses already-fetched weeks from
 * cache — only a never-seen week hits the network, and a past week never hits it
 * again. This is what turns date filtering on this table into a cache read
 * instead of a fresh DB query per range. The keys share the
 * `['dashboard-table','shipped', …]` prefix so existing refresh invalidations
 * still bust every bucket.
 */
export function useShippedWeekBuckets({
  rangeStart,
  rangeEnd,
  packedBy,
  testedBy,
  staffId,
  shippedFilter,
  enabled,
}: UseShippedWeekBucketsParams): ShippedWeekBucketsResult {
  const buckets = enabled ? getWeekBucketsForRange(rangeStart, rangeEnd) : [];

  return useQueries({
    queries: buckets.map(({ weekStart, weekEnd }) => ({
      // Key + fetch + TTLs come from the shared factory (SoT) so the warm-up
      // prefetch and this live query can never drift apart.
      ...dashboardShippedWeekQuery({ weekStart, weekEnd, packedBy, testedBy, staffId, shippedFilter }),
      placeholderData: (prev: PackerRecord[] | undefined) => prev,
      enabled,
    })),
    // `combine` memoizes the merged result so a stable reference flows downstream
    // (no re-derive churn in the filter pipeline when nothing changed).
    combine: (results) => ({
      rows: results.flatMap((r) => r.data ?? []),
      isLoading: results.some((r) => r.isLoading),
      isFetching: results.some((r) => r.isFetching),
    }),
  });
}
