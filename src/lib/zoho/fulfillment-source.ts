/**
 * Source side of the fulfillment sync: enumerate orders that have actually
 * SHIPPED in our authoritative internal system, ready to be pushed to Zoho.
 *
 * Shipped = an `orders` row linked (via shipment_id) to a row in the canonical
 * `shipping_tracking_numbers` table whose carrier status has progressed to
 * accepted / in-transit / out-for-delivery / delivered. This is the same
 * "shipped" gate used by getAllShippedOrders (src/lib/neon/orders-queries.ts).
 *
 * `orders` is line-level (one row per SKU); we group by `order_id` (the channel
 * order id) to assemble a whole order. `order_id` is the join key to a Zoho
 * sales order via salesOrders.referenceNumber.
 */

import { createHash } from 'node:crypto';
import pool from '@/lib/db';

export interface ShippedFulfillmentLine {
  sku: string | null;
  quantity: number;
  productTitle: string | null;
  itemNumber: string | null;
}

export interface ShippedFulfillmentCustomer {
  id: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  zohoContactId: string | null;
  billingAddress: Record<string, unknown> | null;
  shippingAddress: Record<string, unknown> | null;
}

export interface ShippedFulfillmentOrder {
  /** orders.order_id — the channel order id, used as Zoho reference_number. */
  referenceNumber: string;
  channel: string;
  orderDate: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  isDelivered: boolean;
  deliveredAt: string | null;
  /** Most recent change timestamp across the order's rows + tracking — drives the delta cursor. */
  changedAt: string;
  customer: ShippedFulfillmentCustomer | null;
  lines: ShippedFulfillmentLine[];
  /** Stable hash of the shipment-relevant snapshot; lets us skip unchanged completed orders. */
  sourceHash: string;
}

export interface FindShippedOrdersOptions {
  /** Only orders changed at/after this time (delta sync). Omit for a full scan. */
  since?: Date | null;
  /** Max orders to return. */
  limit?: number;
  /** Include FBA / Amazon-fulfilled orders (default false). */
  includeFba?: boolean;
  /** Restrict to a single order_id (used by the manual single-order trigger). */
  referenceNumber?: string;
}

interface AggRow {
  order_id: string;
  channel: string | null;
  order_date: string | null;
  carrier: string | null;
  tracking_number: string | null;
  is_delivered: boolean | null;
  delivered_at: string | null;
  changed_at: string;
  customer_id: number | null;
  lines: ShippedFulfillmentLine[];
}

const SHIPPED_GATE = `COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
  OR stn.is_out_for_delivery OR stn.is_delivered, false)`;

const CHANGED_AT_EXPR = `GREATEST(
  COALESCE(stn.latest_event_at, stn.updated_at, o.created_at),
  COALESCE(stn.delivered_at, o.created_at),
  o.created_at)`;

function computeSourceHash(row: {
  carrier: string | null;
  trackingNumber: string | null;
  isDelivered: boolean;
  lines: ShippedFulfillmentLine[];
}): string {
  const lineKey = row.lines
    .map((l) => `${l.sku ?? ''}:${l.quantity}`)
    .sort()
    .join('|');
  const payload = `${row.carrier ?? ''}~${row.trackingNumber ?? ''}~${row.isDelivered ? 1 : 0}~${lineKey}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/**
 * Returns shipped orders (newest-change last) eligible for Zoho fulfillment.
 * Aggregates line items per order_id and batch-loads the customer record.
 */
export async function findShippedOrdersForFulfillment(
  opts: FindShippedOrdersOptions = {}
): Promise<ShippedFulfillmentOrder[]> {
  const limit = Number.isFinite(Number(opts.limit)) ? Math.max(1, Number(opts.limit)) : 100;
  const conditions: string[] = [
    'o.shipment_id IS NOT NULL',
    "COALESCE(BTRIM(o.order_id), '') <> ''",
    SHIPPED_GATE,
  ];
  const params: unknown[] = [];

  if (!opts.includeFba) {
    conditions.push(`(LOWER(COALESCE(o.account_source, '')) <> 'fba' AND o.order_id NOT ILIKE 'FBA%')`);
  }
  if (opts.referenceNumber) {
    params.push(opts.referenceNumber);
    conditions.push(`o.order_id = $${params.length}`);
  }

  const havingParts: string[] = [];
  if (opts.since) {
    params.push(opts.since.toISOString());
    havingParts.push(`MAX(${CHANGED_AT_EXPR}) >= $${params.length}::timestamptz`);
  }
  const having = havingParts.length ? `HAVING ${havingParts.join(' AND ')}` : '';

  params.push(limit);
  const limitIdx = params.length;

  const sql = `
    SELECT
      o.order_id,
      MAX(o.account_source)                       AS channel,
      to_char(MIN(o.order_date), 'YYYY-MM-DD')    AS order_date,
      MAX(stn.carrier)                            AS carrier,
      MAX(stn.tracking_number_raw)                AS tracking_number,
      bool_or(COALESCE(stn.is_delivered, false))  AS is_delivered,
      to_char(MAX(stn.delivered_at), 'YYYY-MM-DD HH24:MI:SSOF') AS delivered_at,
      to_char(MAX(${CHANGED_AT_EXPR}), 'YYYY-MM-DD HH24:MI:SSOF') AS changed_at,
      MAX(o.customer_id)                          AS customer_id,
      jsonb_agg(jsonb_build_object(
        'sku', o.sku,
        'quantity', COALESCE(NULLIF(o.quantity, '')::numeric, 1),
        'productTitle', o.product_title,
        'itemNumber', o.item_number
      ) ORDER BY o.id)                            AS lines
    FROM orders o
    JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY o.order_id
    ${having}
    ORDER BY MAX(${CHANGED_AT_EXPR}) ASC
    LIMIT $${limitIdx}`;

  const result = await pool.query<AggRow>(sql, params);
  const rows = result.rows;
  if (rows.length === 0) return [];

  // Batch-load customers referenced by the orders.
  const customerIds = Array.from(
    new Set(rows.map((r) => r.customer_id).filter((id): id is number => id != null))
  );
  const customersById = new Map<number, ShippedFulfillmentCustomer>();
  if (customerIds.length > 0) {
    const custRes = await pool.query<{
      id: number;
      display_name: string | null;
      customer_name: string | null;
      email: string | null;
      phone: string | null;
      zoho_contact_id: string | null;
      billing_address: Record<string, unknown> | null;
      shipping_address: Record<string, unknown> | null;
    }>(
      `SELECT id, display_name, customer_name, email, phone, zoho_contact_id,
              billing_address, shipping_address
         FROM customers
        WHERE id = ANY($1::int[])`,
      [customerIds]
    );
    for (const c of custRes.rows) {
      customersById.set(c.id, {
        id: c.id,
        name: c.display_name || c.customer_name || null,
        email: c.email,
        phone: c.phone,
        zohoContactId: c.zoho_contact_id,
        billingAddress: c.billing_address,
        shippingAddress: c.shipping_address,
      });
    }
  }

  return rows.map((r) => {
    const lines: ShippedFulfillmentLine[] = (Array.isArray(r.lines) ? r.lines : []).map((l) => ({
      sku: l.sku ?? null,
      quantity: Number(l.quantity) || 1,
      productTitle: l.productTitle ?? null,
      itemNumber: l.itemNumber ?? null,
    }));
    const isDelivered = Boolean(r.is_delivered);
    return {
      referenceNumber: r.order_id,
      channel: r.channel || 'unknown',
      orderDate: r.order_date,
      carrier: r.carrier,
      trackingNumber: r.tracking_number,
      isDelivered,
      deliveredAt: r.delivered_at,
      changedAt: r.changed_at,
      customer: r.customer_id != null ? customersById.get(r.customer_id) ?? null : null,
      lines,
      sourceHash: computeSourceHash({
        carrier: r.carrier,
        trackingNumber: r.tracking_number,
        isDelivered,
        lines,
      }),
    };
  });
}
