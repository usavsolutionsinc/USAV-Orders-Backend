import type { TimelineItem, TimelineTone } from './types';

/** One audit_logs row for an order, as returned by /api/orders/[id]/timeline. */
export interface OrderAuditRow {
  id: number;
  created_at: string | null;
  action: string;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  actor_name: string | null;
}

const ACTION_MAP: Record<string, { title: string; tone: TimelineTone }> = {
  'orders.tracking.added': { title: 'Tracking added', tone: 'info' },
  'orders.label.printed': { title: 'Label printed', tone: 'success' },
  PACK_COMPLETED: { title: 'Packed', tone: 'success' },
  'shipment.scan_out': { title: 'Shipped — scanned out', tone: 'success' },
  'orders.update': { title: 'Order edited', tone: 'muted' },
  ORDER_ASSIGNMENT_UPDATED: { title: 'Order updated', tone: 'muted' },
  'orders.delete': { title: 'Order deleted', tone: 'danger' },
};

// Keys whose ORDER_ASSIGNMENT_UPDATED row is fully covered by the dedicated
// `orders.tracking.added` event — drop those to avoid a redundant double row.
const TRACKING_ONLY_KEYS = new Set([
  'shippingTrackingNumber',
  'trackingLinkCreates',
  'trackingLinkEdits',
  'trackingLinkDeletes',
]);

function pretty(action: string): string {
  const s = action.replace(/[._-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Map order audit rows → timeline items for the {@link EventTimeline} in the
 * order details panel. Curates titles/tones for the governing events
 * (tracking added, label printed, packed, shipped) and drops the redundant
 * assignment row that only carried a tracking change.
 */
export function orderAuditToTimeline(rows: OrderAuditRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const r of rows) {
    const changedKeys = Array.isArray(r.metadata?.changedFieldKeys)
      ? (r.metadata!.changedFieldKeys as string[])
      : [];

    if (
      r.action === 'ORDER_ASSIGNMENT_UPDATED' &&
      changedKeys.length > 0 &&
      changedKeys.every((k) => TRACKING_ONLY_KEYS.has(k))
    ) {
      continue; // covered by orders.tracking.added
    }

    const mapped = ACTION_MAP[r.action];
    const title = mapped?.title ?? pretty(r.action);
    const tone = mapped?.tone ?? 'muted';

    let subtitle: string | undefined;
    if (r.action === 'orders.tracking.added') {
      const t = String((r.after_data?.trackingNumber as string | undefined) ?? '').trim();
      if (t) subtitle = `…${t.slice(-6)}`;
    } else if (r.action === 'ORDER_ASSIGNMENT_UPDATED' && changedKeys.length > 0) {
      subtitle = changedKeys.join(', ');
    }

    items.push({
      id: r.id,
      at: r.created_at,
      title,
      tone,
      subtitle,
      actor: r.actor_name ?? undefined,
    });
  }
  return items;
}
