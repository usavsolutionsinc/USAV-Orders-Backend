'use client';

import { useQueries } from '@tanstack/react-query';
import { dashboardShippedWeekQuery, SHIPPED_WEEK_PAGE_SIZE } from '@/lib/queries/dashboard-queries';
import { getWeekBucketsForRange } from '@/lib/dashboard-week-range';
import type { PackerRecord } from '@/hooks/usePackerLogs';
import type { ShippedTypeFilter } from './useShippedTableFilters';

interface UseShippedWeekBucketsParams {
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
  /** Per-week row ceiling; default {@link SHIPPED_WEEK_PAGE_SIZE}. */
  limit?: number;
}

interface ShippedWeekBucketsResult {
  rows: PackerRecord[];
  isLoading: boolean;
  isFetching: boolean;
  /** True when any fetched week filled its ceiling (more rows exist → Load more). */
  truncated: boolean;
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
  limit = SHIPPED_WEEK_PAGE_SIZE,
}: UseShippedWeekBucketsParams): ShippedWeekBucketsResult {
  const buckets = enabled ? getWeekBucketsForRange(rangeStart, rangeEnd) : [];

  return useQueries({
    queries: buckets.map(({ weekStart, weekEnd }) => ({
      // Key + fetch + TTLs come from the shared factory (SoT) so the warm-up
      // prefetch and this live query can never drift apart.
      ...dashboardShippedWeekQuery({ weekStart, weekEnd, packedBy, testedBy, staffId, shippedFilter, limit }),
      placeholderData: (prev: PackerRecord[] | undefined) => prev,
      enabled,
    })),
    // `combine` memoizes the merged result so a stable reference flows downstream
    // (no re-derive churn in the filter pipeline when nothing changed).
    combine: (results) => ({
      rows: results.flatMap((r) => r.data ?? []),
      isLoading: results.some((r) => r.isLoading),
      isFetching: results.some((r) => r.isFetching),
      // A week that returned exactly `limit` rows hit the ceiling → more exist.
      truncated: results.some((r) => (r.data?.length ?? 0) >= limit),
    }),
  });
}
