import pool from '@/lib/db';
import { publishOrderChanged, publishShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

/**
 * After a shipment tracking status is updated (webhook or sync job), notify all
 * clients so the UI live-updates like the carrier's own website.
 *
 * Two audiences:
 *   1. **Always** — a `shipment.changed` event so the receiving/incoming carrier
 *      panels refresh, regardless of whether the shipment is tied to an order.
 *      (Inbound third-party tracking numbers usually have no order linkage.)
 *   2. **Order-linked only** — an `order.changed` event + cache invalidation so
 *      the dashboard/shipped views refresh.
 */
export async function publishShipmentStatusChange(
  shipmentId: number,
  source: string,
  trackingNumber?: string | null
): Promise<void> {
  // (1) Shipment-level event first — never gated on order linkage, so a bad
  // orders lookup can't suppress the receiving-panel live update.
  try {
    await publishShipmentChanged({ shipmentId, trackingNumber, source });
  } catch (error) {
    console.error('[publish-on-status-change] shipment publish failed:', error);
  }

  // (2) Order-linked views.
  try {
    const result = await pool.query(
      'SELECT id FROM orders WHERE shipment_id = $1',
      [shipmentId]
    );
    const orderIds = result.rows
      .map((r: any) => Number(r.id))
      .filter(Number.isFinite);
    if (orderIds.length === 0) return;

    await invalidateCacheTags(['orders', 'shipped', 'orders-next']);
    await publishOrderChanged({ orderIds, source });
  } catch (error) {
    console.error('[publish-on-status-change] order publish failed:', error);
  }
}
