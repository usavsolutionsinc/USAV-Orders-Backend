'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { IdentifierToggle } from '@/components/ui/IdentifierToggle';
import type { TimelineGroupMode } from '@/components/ui/EventTimeline';
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
/** Serial↔order toggle options for the order timeline header. */
const ORDER_TIMELINE_TOGGLE_OPTIONS: ReadonlyArray<{ value: TimelineGroupMode; label: string }> = [
  { value: 'time', label: 'Order' },
  { value: 'serial', label: 'Serial' },
];

export function OrderTimelineSection({ orderId }: { orderId: number }) {
  const [groupMode, setGroupMode] = useState<TimelineGroupMode>('time');
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
  const items = useMemo(
    () =>
      collapseTimeline(
        [
          ...orderAuditToTimeline(data?.events ?? []),
          ...inventoryEventsToTimeline(data?.lifecycle ?? []),
          ...stationActivityToTimeline(data?.stationEvents ?? []),
        ].sort((a, b) => {
          const ta = a.at ? new Date(a.at).getTime() : 0;
          const tb = b.at ? new Date(b.at).getTime() : 0;
          return tb - ta;
        }),
      ),
    [data?.events, data?.lifecycle, data?.stationEvents],
  );

  // Only offer the serial view when there's at least one serial/identifier to
  // group by — otherwise the toggle would just relabel the same flat list.
  const hasSerials = useMemo(() => items.some((it) => it.ref), [items]);

  return (
    <TimelineSection
      items={items}
      loading={isLoading}
      groupMode={groupMode}
      headerRight={
        !isLoading && items.length > 0 ? (
          <div className="flex items-center gap-3">
            {hasSerials ? (
              <IdentifierToggle
                value={groupMode}
                onChange={setGroupMode}
                options={ORDER_TIMELINE_TOGGLE_OPTIONS}
                ariaLabel="Timeline grouping"
              />
            ) : null}
            <span>{items.length} events</span>
          </div>
        ) : undefined
      }
    />
  );
}
