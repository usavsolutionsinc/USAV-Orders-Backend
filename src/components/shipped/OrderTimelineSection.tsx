'use client';

import { useQuery } from '@tanstack/react-query';
import { TimelineSection } from '@/components/ui/TimelineSection';
import {
  orderAuditToTimeline,
  inventoryEventsToTimeline,
  stationActivityToTimeline,
  collapseTimeline,
  type OrderAuditRow,
  type InventoryTimelineRow,
  type StationActivityRow,
} from '@/lib/timeline';

interface OrderTimelinePayload {
  events: OrderAuditRow[];
  lifecycle: InventoryTimelineRow[];
  stationEvents: StationActivityRow[];
}

/**
 * Order activity timeline for the details panel — fetches the order's audit
 * trail (order-anchored) plus the tech VERDICT (unit-anchored `inventory_events`
 * TEST_*), merges them newest-first, and renders through the shared
 * {@link EventTimeline}. Self-contained so the panel adds it with one line.
 */
export function OrderTimelineSection({ orderId }: { orderId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['order-timeline', orderId],
    queryFn: async (): Promise<OrderTimelinePayload> => {
      const res = await fetch(`/api/orders/${orderId}/timeline`);
      if (!res.ok) throw new Error('Failed to fetch order timeline');
      const json = await res.json();
      return {
        events: (json.events ?? []) as OrderAuditRow[],
        lifecycle: (json.lifecycle ?? []) as InventoryTimelineRow[],
        stationEvents: (json.stationEvents ?? []) as StationActivityRow[],
      };
    },
    enabled: Number.isFinite(orderId) && orderId > 0,
    staleTime: 30_000,
  });

  // Merge all spines and re-sort newest-first (EventTimeline day-groups in
  // array order, so the merged list must be ordered, not just concatenated),
  // then collapse adjacent duplicate scans so repeated tech re-scans fold into
  // one row instead of cluttering the trail.
  const items = collapseTimeline(
    [
      ...orderAuditToTimeline(data?.events ?? []),
      ...inventoryEventsToTimeline(data?.lifecycle ?? []),
      ...stationActivityToTimeline(data?.stationEvents ?? []),
    ].sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    }),
  );

  return (
    <TimelineSection
      items={items}
      loading={isLoading}
      headerRight={!isLoading && items.length > 0 ? `${items.length} events` : undefined}
    />
  );
}
