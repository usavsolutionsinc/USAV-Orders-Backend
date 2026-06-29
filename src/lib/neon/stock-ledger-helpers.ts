import type { PoolClient } from 'pg';
import pool from '../db';
import { publishStockLedgerEvent } from '@/lib/realtime/publish';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

type Queryable = Pick<PoolClient, 'query'> | typeof pool;

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
 * Returns the inserted ledger rows (empty if already emitted or no orders).
 */
export async function emitShippedLedgerForShipment(
  db: Queryable,
  shipmentId: number,
  opts?: { staffId?: number | null; source?: string },
  orgId?: OrgId,
): Promise<Array<{ id: number; sku: string; delta: number }>> {
  if (!shipmentId) return [];

  // When no orgId is threaded (carrier-sync / webhook paths — shipping_tracking_
  // numbers has no organization_id column to resolve it from), derive the owning
  // org from the shipment's own orders. shipment_id is globally unique, so a
  // shipment maps to exactly one org's orders; this stamps the ledger + targets
  // the realtime publish at the CORRECT tenant instead of the USAV fallback.
  // Only adopt it when the orders resolve to a single org (no ambiguity).
  if (!orgId) {
    try {
      const derived = await db.query<{ organization_id: string }>(
        `SELECT DISTINCT organization_id FROM orders
          WHERE shipment_id = $1 AND organization_id IS NOT NULL`,
        [shipmentId],
      );
      if (derived.rows.length === 1) {
        orgId = derived.rows[0].organization_id as OrgId;
      }
    } catch {
      /* derivation is best-effort; fall through to the transitional path */
    }
  }

  // Tenant-aware path: when an orgId is threaded through, set the org GUC on
  // the supplied executor (so RLS/loud-fail defaults resolve to the right
  // tenant) and add explicit organization_id predicates on the read, the
  // orders SELECT (string-key sku join is scoped via the same shipment row),
  // and stamp organization_id on the inserted ledger rows. SET LOCAL is used
  // so it's transaction-scoped on the caller's tx client and never leaks onto
  // a pooled connection. When orgId is omitted, behavior is byte-identical to
  // the original raw-executor path below.
  if (orgId) {
    await db.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

    const existing = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
       FROM sku_stock_ledger
       WHERE ref_shipment_id = $1 AND reason = 'SHIPPED'
         AND organization_id = $2`,
      [shipmentId, orgId],
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
      [opts?.staffId ?? null, shipmentId, `Carrier accepted shipment ${shipmentId}`, orgId],
    );

    const source = opts?.source ?? 'shipment.carrier-accepted';
    for (const row of result.rows) {
      try {
        await publishStockLedgerEvent({
          organizationId: orgId,
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

  const existing = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt
     FROM sku_stock_ledger
     WHERE ref_shipment_id = $1 AND reason = 'SHIPPED'`,
    [shipmentId],
  );
  if ((existing.rows[0]?.cnt ?? 0) > 0) return [];

  const result = await db.query<{ id: number; sku: string; delta: number }>(
    `INSERT INTO sku_stock_ledger
       (sku, delta, reason, dimension, staff_id,
        ref_shipment_id, notes)
     SELECT
       q.sku,
       -SUM(q.qty_int)::int,
       'SHIPPED',
       'BOXED',
       $1,
       $2,
       $3
     FROM (
       SELECT
         o.sku,
         COALESCE(
           NULLIF(regexp_replace(COALESCE(o.quantity, ''), '[^0-9-]', '', 'g'), '')::int,
           1
         ) AS qty_int
       FROM orders o
       WHERE o.shipment_id = $2
         AND o.sku IS NOT NULL
         AND BTRIM(o.sku) <> ''
     ) q
     GROUP BY q.sku
     RETURNING id, sku, delta`,
    [opts?.staffId ?? null, shipmentId, `Carrier accepted shipment ${shipmentId}`],
  );

  const source = opts?.source ?? 'shipment.carrier-accepted';
  // TRANSITIONAL: this drains the boxed counter from carrier-sync / webhook
  // paths that have no session. Single-tenant (USAV) today; derive from the
  // shipment's organization_id once shipping_tracking_numbers carries it (Phase B).
  const fallbackOrgId = transitionalUsavOrgId();
  for (const row of result.rows) {
    try {
      await publishStockLedgerEvent({
        organizationId: fallbackOrgId,
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
