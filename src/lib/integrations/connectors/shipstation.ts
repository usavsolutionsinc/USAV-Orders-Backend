/**
 * ShipStation connector sync adapter — connection-driven order ingestion.
 *
 * Pulls the org's orders through the LEGACY v1 API (the only ShipStation surface
 * that returns orders with SKUs + weight; v2 has no order-list endpoint) and
 * upserts them into `orders` with the SAME uniform shape eBay/Amazon/Square use
 * (account_source / sale_amount / currency), so every downstream surface renders
 * generically. Rate/label BUYING is v2 (src/lib/shipping/shipstation/*).
 *
 * Reuses:
 *   - getShipStationV1 (vault creds → bound v1 client)
 *   - the orders upsert shape from src/lib/integrations/connectors/square.ts
 *     (idx_orders_unique_account_order)
 *   - getSyncCursor / updateSyncCursor for the incremental modifyDate watermark
 *
 * Ship-to is NOT written to `customers` here; the rate/label endpoints fetch the
 * authoritative ship-to + stored weight live from the v1 order. Populating
 * `customers` at sync time is a documented follow-up.
 *
 * Lazily imported by the registry so the connection reader never bundles the
 * ShipStation client.
 */
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { getSyncCursor, updateSyncCursor } from '@/lib/sync-cursors';
import { getShipStationV1 } from '@/lib/shipping/shipstation/config';
import type { ShipStationV1Order } from '@/lib/shipping/shipstation/orders-v1';
import type { SyncOutcome } from './types';

const ACCOUNT_SOURCE = 'shipstation';
const FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 25; // safety bound: 25 * 100 = 2.5k orders / run

/** One representative line for the orders row (v1 orders are multi-line). */
function summarizeItems(order: ShipStationV1Order): { title: string; quantity: number } {
  const items = order.items ?? [];
  const quantity = items.reduce((s, it) => s + (it.quantity || 0), 0) || 1;
  const first = items.find((it) => (it.name ?? '').trim())?.name?.trim();
  const title = !first
    ? `ShipStation order ${order.orderNumber}`
    : items.length > 1
      ? `${first} +${items.length - 1} more`
      : first;
  return { title, quantity };
}

/** ShipStation status → our orders.status. awaiting_shipment lands in the
 *  outbound "needs a label" queue (unassigned); shipped is terminal. */
function mapStatus(orderStatus: string | null): string {
  return (orderStatus ?? '').toLowerCase() === 'shipped' ? 'shipped' : 'unassigned';
}

async function upsertOrder(orgId: OrgId, order: ShipStationV1Order): Promise<'created' | 'updated'> {
  const { title, quantity } = summarizeItems(order);
  const firstSku = order.items.find((it) => (it.sku ?? '').trim())?.sku?.trim() || '';

  const result = await pool.query(
    `INSERT INTO orders (
       organization_id, order_id, product_title, condition, sku, status, status_history, notes,
       quantity, out_of_stock, account_source, order_date, sku_catalog_id, sale_amount, currency
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15
     )
     ON CONFLICT ON CONSTRAINT idx_orders_unique_account_order DO UPDATE
       SET product_title = COALESCE(NULLIF(EXCLUDED.product_title, ''), orders.product_title),
           quantity   = COALESCE(NULLIF(orders.quantity, ''), EXCLUDED.quantity),
           sku        = COALESCE(NULLIF(orders.sku, ''), EXCLUDED.sku),
           order_date = COALESCE(orders.order_date, EXCLUDED.order_date),
           sale_amount = COALESCE(orders.sale_amount, EXCLUDED.sale_amount),
           currency   = COALESCE(NULLIF(orders.currency, ''), EXCLUDED.currency),
           status = CASE
             WHEN orders.status IS NULL OR orders.status = '' OR orders.status = 'unassigned' THEN EXCLUDED.status
             ELSE orders.status
           END
       RETURNING (xmax = 0) AS inserted`,
    [
      orgId,
      order.orderNumber,
      title,
      '',
      firstSku,
      mapStatus(order.orderStatus),
      JSON.stringify([]),
      '',
      String(quantity),
      '',
      ACCOUNT_SOURCE,
      order.orderDate ?? null,
      null,
      order.orderTotal ?? null,
      'USD',
    ],
  );
  return result.rows[0]?.inserted ? 'created' : 'updated';
}

export async function shipstationSync(orgId: OrgId): Promise<SyncOutcome> {
  const client = await getShipStationV1(orgId);
  if (!client) {
    return {
      ok: false,
      error:
        'shipstation: legacy v1 API key/secret not configured — order pull needs the v1 credentials (v2 has no order-list endpoint).',
    };
  }

  const cursorKey = `shipstation:orders:${orgId}`;
  const since = (await getSyncCursor(cursorKey)) ?? new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);
  let imported = 0;
  let updated = 0;
  let maxModified = since.getTime();
  const errors: string[] = [];

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await client.listOrders({
        modifyDateStart: since.toISOString(),
        page,
        pageSize: PAGE_SIZE,
      });

      for (const order of res.orders) {
        // Skip cancelled orders — they must never land in the labels queue.
        if ((order.orderStatus ?? '').toLowerCase() === 'cancelled') continue;
        try {
          if ((await upsertOrder(orgId, order)) === 'created') imported++;
          else updated++;
        } catch (e) {
          errors.push(`${order.orderNumber}: ${e instanceof Error ? e.message : String(e)}`);
        }
        const ts = order.modifyDate ? Date.parse(order.modifyDate) : NaN;
        if (Number.isFinite(ts) && ts > maxModified) maxModified = ts;
      }

      if (page >= res.pages) break;
    }

    // Advance the watermark only on a clean run so a mid-page failure re-pulls.
    if (errors.length === 0 && maxModified > since.getTime()) {
      await updateSyncCursor(cursorKey, new Date(maxModified));
    }
  } catch (e) {
    return { ok: false, error: `shipstation: ${e instanceof Error ? e.message : String(e)}` };
  }

  return {
    ok: errors.length === 0,
    imported,
    updated,
    error: errors.length ? errors.join('; ') : undefined,
    cursor: new Date(maxModified).toISOString(),
  };
}
