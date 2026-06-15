import pool from '@/lib/db';
import { publishOrderChanged, publishShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { tenantQuery, transitionalUsavOrgId } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

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
  trackingNumber?: string | null,
  orgId?: OrgId
): Promise<void> {
  // TRANSITIONAL: carrier webhooks / sync jobs have no session. Until inbound
  // shipping_tracking_numbers carries organization_id (Phase B), these single-
  // tenant integration paths stamp the USAV org. Then derive it from the
  // shipment / linked order's organization_id instead.
  //
  // Tenant-aware: when a caller threads `orgId`, the orders lookup runs through
  // the tenant-scoped pool with an explicit `organization_id` predicate and the
  // realtime fan-out is scoped to that tenant. When omitted, behavior is
  // byte-identical to the pre-migration path (raw pool + USAV fallback) so the
  // many un-migrated callers keep compiling and behaving as today.
  const publishOrgId = orgId ?? transitionalUsavOrgId();

  // (1) Shipment-level event first — never gated on order linkage, so a bad
  // orders lookup can't suppress the receiving-panel live update.
  try {
    await publishShipmentChanged({ organizationId: publishOrgId, shipmentId, trackingNumber, source });
  } catch (error) {
    console.error('[publish-on-status-change] shipment publish failed:', error);
  }

  // (2) Order-linked views.
  try {
    // `orders` is tenant-owned (organization_id present). Surrogate-PK column
    // shipment_id is an integer FK, so the only org-scoping needed is an
    // explicit AND organization_id = $n when a tenant is threaded.
    const result = orgId
      ? await tenantQuery(
          orgId,
          'SELECT id FROM orders WHERE shipment_id = $1 AND organization_id = $2',
          [shipmentId, orgId]
        )
      : await pool.query(
          'SELECT id FROM orders WHERE shipment_id = $1',
          [shipmentId]
        );
    const orderIds = result.rows
      .map((r: any) => Number(r.id))
      .filter(Number.isFinite);
    if (orderIds.length === 0) return;

    await invalidateCacheTags(['orders', 'shipped', 'orders-next']);
    await publishOrderChanged({ organizationId: publishOrgId, orderIds, source });
  } catch (error) {
    console.error('[publish-on-status-change] order publish failed:', error);
  }
}
