'use client';

import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { mergeJourney, type JourneyEvent } from '@/lib/timeline/journey';
import type { OperationsTimelineUrlState } from '@/components/sidebar/operations/useOperationsTimelineUrlState';
import { operationsJourneyBrowseInfiniteQuery } from '@/lib/queries/operations-journey-queries';

/**
 * Drives the Operations → History BROWSE region: the org-wide, filterable,
 * keyset-paginated event feed (no record number required). Fetches
 * `GET /api/operations/journey` in `mode:'browse'` via `useInfiniteQuery`,
 * flattens the cursor pages, and runs them through the same shared
 * `mergeJourney` adapter the focused Trace uses — so a browse row and a trace
 * row render identically (one `EventTimeline` primitive, no forked mapping).
 *
 * Monitor archetype: observe-only, refetch-on-focus (React Query default) keeps
 * it fresh; there is no realtime in-place patching and no durable selection.
 *
 * `enabled` gates the fetch to when the Browse region is actually on-screen
 * (flag on, not focused on a record, not showing the unified `?q=` search hits),
 * so switching to Trace/Results doesn't keep the feed polling.
 */
export function useOperationsJourneyBrowse(
  url: OperationsTimelineUrlState,
  enabled: boolean,
) {
  const query = useInfiniteQuery({
    ...operationsJourneyBrowseInfiniteQuery(url.filters),
    enabled,
  });

  const events: JourneyEvent[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.events) ?? [],
    [query.data],
  );

  const { items } = useMemo(() => mergeJourney(events), [events]);

  return {
    items,
    eventCount: items.length,
    isLoading: enabled && query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
