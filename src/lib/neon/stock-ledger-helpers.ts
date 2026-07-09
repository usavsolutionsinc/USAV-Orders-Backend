import type { PoolClient } from 'pg';
import { publishStockLedgerEvent } from '@/lib/realtime/publish';
import { resolveShipmentOrgId } from '@/lib/shipping/resolve-shipment-org';
import type { OrgId } from '@/lib/tenancy/constants';

type Queryable = Pick<PoolClient, 'query'>;

/**
 * Emit SHIPPED/BOXED ledger rows for a shipment — idempotent.
 *
 * Called when a shipping_tracking_numbers row transitions to "carrier accepted"
 * (the point where we've handed the package to the carrier). Drains the
 * boxed_stock counter that was incremented at pack time.
 *
 * Idempotency: if any SHIPPED row already exists for this shipment_id, this
 * function is a no-op. Safe to call from retries, webhooks replaying events,
 * or multiple carrier-sync jobs racing.
 *
 * Caller must run inside `withTenantTransaction(orgId, …)` so the GUC and
 * fn_recompute_sku_stock trigger see the correct organization_id.
 *
 * Returns the inserted ledger rows (empty if already emitted or no orders).
 */
export async function emitShippedLedgerForShipment(
  db: Queryable,
  shipmentId: number,
  opts?: { staffId?: number | null; source?: string },
  orgId?: OrgId,
): Promise<Array<{ id: number; sku: string; delta: number }>> {
  if (!shipmentId) return [];

  const resolvedOrgId = await resolveShipmentOrgId(shipmentId, orgId, db);
  if (!resolvedOrgId) {
    throw new Error(
      `[emitShippedLedgerForShipment] unresolved organization_id for shipment ${shipmentId}`,
    );
  }

  const existing = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt
     FROM sku_stock_ledger
     WHERE ref_shipment_id = $1 AND reason = 'SHIPPED'
       AND organization_id = $2`,
    [shipmentId, resolvedOrgId],
  );
  if ((existing.rows[0]?.cnt ?? 0) > 0) return [];

  const result = await db.query<{ id: number; sku: string; delta: number }>(
    `INSERT INTO sku_stock_ledger
       (sku, delta, reason, dimension, staff_id,
        ref_shipment_id, notes, organization_id)
     SELECT
       q.sku,
       -SUM(q.qty_int)::int,
       'SHIPPED',
       'BOXED',
       $1,
       $2,
       $3,
       $4
     FROM (
       SELECT
         o.sku,
         COALESCE(
           NULLIF(regexp_replace(COALESCE(o.quantity, ''), '[^0-9-]', '', 'g'), '')::int,
           1
         ) AS qty_int
       FROM orders o
       WHERE o.shipment_id = $2
         AND o.organization_id = $4
         AND o.sku IS NOT NULL
         AND BTRIM(o.sku) <> ''
     ) q
     GROUP BY q.sku
     RETURNING id, sku, delta`,
    [opts?.staffId ?? null, shipmentId, `Carrier accepted shipment ${shipmentId}`, resolvedOrgId],
  );

  const source = opts?.source ?? 'shipment.carrier-accepted';
  for (const row of result.rows) {
    try {
      await publishStockLedgerEvent({
        organizationId: resolvedOrgId,
        ledgerId: row.id,
        sku: row.sku,
        delta: row.delta,
        reason: 'SHIPPED',
        dimension: 'BOXED',
        staffId: opts?.staffId ?? null,
        source,
      });
    } catch (err) {
      console.warn('[emitShippedLedgerForShipment] realtime publish failed', err);
    }
  }

  return result.rows;
}
