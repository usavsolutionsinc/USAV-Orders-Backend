'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  type JourneyEntitySummary,
} from '@/lib/queries/operations-journey-queries';

/**
 * Drives the Master Operations Journey right pane. This is a RECORD LOOKUP — it
 * only fetches once a specific order/serial/tracking number is in the URL; there
 * is no "browse all events" firehose. The fetched record's events (bucketed by
 * source) merge through the shared adapters; the grouping map feeds
 * `EventTimeline`'s `groupKeyOf`.
 *
 * Realtime: this is a Monitor (observe-only), so a station/order nudge triggers a
 * debounced query *invalidation* (refetch), never an in-place patch.
 */
export function useOperationsJourney(url: OperationsTimelineUrlState) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const focused = url.focused;

  const query = useQuery({
    ...operationsJourneyFocusedQuery(url.filters),
    enabled: focused,
  });

  const events: JourneyEvent[] = useMemo(
    () => (focused ? query.data?.events ?? [] : []),
    [focused, query.data],
  );

  const { items, groupOf } = useMemo(() => mergeJourney(events), [events]);

  const entity: JourneyEntitySummary | null = focused ? query.data?.entity ?? null : null;

  // ── Realtime: debounced invalidate (Monitor: refetch, never patch) ──
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: journeyKeys.all });
    }, 750);
  }, [queryClient]);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const ordersChannel = safeChannelName(() => getOrdersChannelName(orgId!));
  const stationChannel = safeChannelName(() => getStationChannelName(orgId!));

  // Subscribe only to the meaningful, lower-frequency journey nudges (tech
  // serial-add → order.tested; order edits → order.changed; receiving →
  // receiving-log.changed). We deliberately do NOT subscribe to the dashboard
  // `activity_event` firehose (fires per scan).
  useAblyChannel(ordersChannel, 'order.tested', invalidate, !!ordersChannel);
  useAblyChannel(ordersChannel, 'order.changed', invalidate, !!ordersChannel);
  useAblyChannel(stationChannel, 'receiving-log.changed', invalidate, !!stationChannel);

  return {
    focused,
    items,
    groupOf,
    entity,
    isLoading: focused && query.isLoading,
    isError: focused && query.isError,
    refetch: query.refetch,
  };
}
