'use client';

import { useQuery } from '@tanstack/react-query';
import { EventTimeline } from '@/components/ui/EventTimeline';
import { orderAuditToTimeline, type OrderAuditRow } from '@/lib/timeline';

/**
 * Order activity timeline for the details panel — fetches the order's audit
 * trail and renders it through the shared {@link EventTimeline} (same look as the
 * receiving carrier-events trail). Self-contained so the panel adds it with one line.
 */
export function OrderTimelineSection({ orderId }: { orderId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['order-timeline', orderId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/timeline`);
      if (!res.ok) throw new Error('Failed to fetch order timeline');
      const json = await res.json();
      return (json.events ?? []) as OrderAuditRow[];
    },
    enabled: Number.isFinite(orderId) && orderId > 0,
    staleTime: 30_000,
  });

  const items = orderAuditToTimeline(data ?? []);

  return (
    <section className="mx-8 mt-2 border-t border-gray-100 pt-4 pb-8">
      <h3 className="mb-2 text-eyebrow font-black uppercase tracking-wider text-gray-500">Activity</h3>
      {isLoading ? (
        <div className="flex h-20 items-center justify-center text-caption font-medium text-gray-400">
          Loading…
        </div>
      ) : (
        <EventTimeline items={items} emptyMessage="No activity recorded yet." />
      )}
    </section>
  );
}
