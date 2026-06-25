'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import {
  getOrdersChannelName,
  getStationChannelName,
  safeChannelName,
} from '@/lib/realtime/channels';
import { mergeJourney, type JourneyEvent } from '@/lib/timeline/journey';
import type { OperationsTimelineUrlState } from '@/components/sidebar/operations/useOperationsTimelineUrlState';
import {
  journeyKeys,
  operationsJourneyFocusedQuery,
  operationsJourneyBrowseQueryConfig,
  type JourneyEntitySummary,
} from '@/lib/queries/operations-journey-queries';

/**
 * Drives the Master Operations Journey right pane. Focused mode (a serial/order/
 * tracking in the URL) fetches that entity's full journey; browse mode paginates
 * recent activity. Merges the bucketed-by-source events through the shared
 * adapters and exposes the grouping map for `EventTimeline`'s `groupKeyOf`.
 *
 * Realtime: this is a Monitor (observe-only), so a station/order nudge triggers a
 * debounced query *invalidation* (refetch), never an in-place patch.
 */
export function useOperationsJourney(url: OperationsTimelineUrlState) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const focused = url.focused;

  const focusedQuery = useQuery({
    ...operationsJourneyFocusedQuery(url.filters),
    enabled: focused,
  });

  const browseQuery = useInfiniteQuery({
    ...operationsJourneyBrowseQueryConfig(url.filters),
    enabled: !focused,
  });

  const events: JourneyEvent[] = useMemo(() => {
    if (focused) return focusedQuery.data?.events ?? [];
    return browseQuery.data?.pages.flatMap((p) => p.events) ?? [];
  }, [focused, focusedQuery.data, browseQuery.data]);

  const { items, groupOf } = useMemo(() => mergeJourney(events), [events]);

  const entity: JourneyEntitySummary | null = focused ? focusedQuery.data?.entity ?? null : null;

  // ── Realtime: debounced invalidate (Monitor: refetch, never patch) ──
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: journeyKeys.all });
    }, 750);
  }, [queryClient]);
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const ordersChannel = safeChannelName(() => getOrdersChannelName(orgId!));
  const stationChannel = safeChannelName(() => getStationChannelName(orgId!));

  // Subscribe only to the meaningful, lower-frequency journey nudges (tech
  // serial-add → order.tested; order edits → order.changed; receiving →
  // receiving-log.changed). We deliberately do NOT subscribe to the dashboard
  // `activity_event` firehose (fires per scan), which would re-run the browse
  // UNION every ~750ms during active station work.
  useAblyChannel(ordersChannel, 'order.tested', invalidate, !!ordersChannel);
  useAblyChannel(ordersChannel, 'order.changed', invalidate, !!ordersChannel);
  useAblyChannel(stationChannel, 'receiving-log.changed', invalidate, !!stationChannel);

  return {
    focused,
    items,
    groupOf,
    entity,
    // focused-mode state
    isLoading: focused ? focusedQuery.isLoading : browseQuery.isLoading,
    isError: focused ? focusedQuery.isError : browseQuery.isError,
    refetch: focused ? focusedQuery.refetch : browseQuery.refetch,
    // browse-mode pagination
    hasNextPage: !focused && browseQuery.hasNextPage,
    isFetchingNextPage: browseQuery.isFetchingNextPage,
    fetchNextPage: browseQuery.fetchNextPage,
    notFound: focused && focusedQuery.isError,
  };
}
