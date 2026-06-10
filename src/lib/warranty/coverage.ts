/**
 * Warranty coverage lookup — the read-only "is this still under warranty?" check
 * a support rep runs while on the phone with a customer. Resolves an order #,
 * serial, or SKU to its shipped order, then computes the same warranty clock the
 * Log Claim flow stamps (computeWarranty + resolveWarrantyDays) — WITHOUT writing
 * anything. Returns null-ish (found:false) when no shipped order matches.
 *
 * Order resolution mirrors mutations.resolveClaimContext (carrier-delivered date
 * from shipping_tracking_numbers; packed date from packer_logs) so a coverage
 * check and a subsequently-logged claim agree on the clock.
 */

import pool from '@/lib/db';
import { computeWarranty, daysUntilExpiry } from './clock';
import type { WarrantyClockBasis } from './clock';
import { resolveWarrantyDays } from './term';
import type { WarrantyClaimStatus, WarrantyCoverageResult } from './types';

interface OrderRow {
  id: number;
  source_order_id: string | null;
  sku: string | null;
  product_title: string | null;
  source_system: string | null;
  customer_id: number | null;
  customer_name: string | null;
  tracking_number: string | null;
  delivered_at: string | null;
  packed_scanned_at: string | null;
  matched_serial: string | null;
}

// Shared projection — same delivered/packed derivation as resolveClaimContext.
const ORDER_SELECT = `
  o.id,
  o.order_id        AS source_order_id,
  o.sku,
  o.product_title,
  o.account_source  AS source_system,
  o.customer_id,
  COALESCE(
    NULLIF(TRIM(c.display_name), ''),
    NULLIF(TRIM(c.customer_name), ''),
    NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
  ) AS customer_name,
  stn.tracking_number_raw AS tracking_number,
  CASE WHEN stn.is_delivered THEN stn.latest_event_at::text END AS delivered_at,
  pl.packed_at::text AS packed_scanned_at
`;

const ORDER_FROM = `
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
  LEFT JOIN LATERAL (
    SELECT pl.created_at AS packed_at
    FROM packer_logs pl
    WHERE pl.shipment_id IS NOT NULL
      AND pl.shipment_id = o.shipment_id
      AND pl.tracking_type = 'ORDERS'
    ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC
    LIMIT 1
  ) pl ON true
`;

async function runResolve(
  matched: string | null,
  extraJoinAndWhere: string,
  params: unknown[],
): Promise<OrderRow | null> {
  try {
    const { rows } = await pool.query<Omit<OrderRow, 'matched_serial'>>(
      `SELECT ${ORDER_SELECT} ${ORDER_FROM} ${extraJoinAndWhere} ORDER BY o.created_at DESC NULLS LAST, o.id DESC LIMIT 1`,
      params,
    );
    if (rows.length === 0) return null;
    return { ...rows[0], matched_serial: matched };
  } catch (err) {
    console.warn('[warranty/coverage] resolve failed:', err);
    return null;
  }
}

/**
 * Resolve a free-text identifier to a shipped order, trying the most specific
 * interpretations first: exact order number → serial (modern serial_units, then
 * legacy tech_serial_numbers) → SKU. Returns the order row + which path matched.
 */
async function resolveOrder(
  q: string,
): Promise<{ row: OrderRow; matchedBy: 'order' | 'serial' | 'sku' } | null> {
  const byOrder = await runResolve(null, `WHERE o.order_id = $1`, [q]);
  if (byOrder) return { row: byOrder, matchedBy: 'order' };

  const bySerialUnit = await runResolve(
    q,
    `JOIN serial_units su ON su.shipment_id = o.shipment_id
     WHERE UPPER(TRIM(su.serial_number)) = UPPER(TRIM($1))`,
    [q],
  );
  if (bySerialUnit) return { row: bySerialUnit, matchedBy: 'serial' };

  const bySerialTech = await runResolve(
    q,
    `JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id
     WHERE UPPER(TRIM(tsn.serial_number)) = UPPER(TRIM($1))`,
    [q],
  );
  if (bySerialTech) return { row: bySerialTech, matchedBy: 'serial' };

  const bySku = await runResolve(null, `WHERE o.sku = $1`, [q]);
  if (bySku) return { row: bySku, matchedBy: 'sku' };

  return null;
}

async function findExistingClaim(
  orderId: number,
  serialNumber: string | null,
): Promise<WarrantyCoverageResult['existingClaim']> {
  try {
    const { rows } = await pool.query<{ id: number; claim_number: string; status: WarrantyClaimStatus }>(
      `SELECT id, claim_number, status
         FROM warranty_claims
        WHERE order_id = $1
           OR ($2::text IS NOT NULL AND UPPER(TRIM(serial_number)) = UPPER(TRIM($2)))
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [orderId, serialNumber],
    );
    if (rows.length === 0) return null;
    return { id: Number(rows[0].id), claimNumber: rows[0].claim_number, status: rows[0].status };
  } catch (err) {
    console.warn('[warranty/coverage] existing-claim lookup failed:', err);
    return null;
  }
}

function emptyResult(query: string): WarrantyCoverageResult {
  return {
    query,
    found: false,
    matchedBy: null,
    orderId: null,
    sourceOrderId: null,
    serialNumber: null,
    sku: null,
    productTitle: null,
    customerId: null,
    customerName: null,
    sourceSystem: null,
    trackingNumber: null,
    deliveredAt: null,
    packedScannedAt: null,
    warrantyStartsAt: null,
    warrantyExpiresAt: null,
    warrantyDays: null,
    clockBasis: null,
    daysRemaining: null,
    inWarranty: null,
    existingClaim: null,
  };
}

/**
 * Look up warranty coverage for a customer-provided identifier. Read-only.
 */
export async function lookupCoverage(
  rawQuery: string,
  organizationId: string | null,
): Promise<WarrantyCoverageResult> {
  const query = rawQuery.trim();
  if (!query) return emptyResult(query);

  const resolved = await resolveOrder(query);
  if (!resolved) return emptyResult(query);

  const { row, matchedBy } = resolved;
  const warrantyDays = await resolveWarrantyDays(organizationId);
  const clock = computeWarranty({
    deliveredAt: row.delivered_at,
    packedScannedAt: row.packed_scanned_at,
    warrantyDays,
  });
  const daysRemaining = daysUntilExpiry(clock.expiresAt);
  // Covered through the last day (daysRemaining === 0); expired once negative.
  const inWarranty = daysRemaining == null ? null : daysRemaining >= 0;

  const existingClaim = await findExistingClaim(Number(row.id), row.matched_serial);

  return {
    query,
    found: true,
    matchedBy,
    orderId: Number(row.id),
    sourceOrderId: row.source_order_id,
    serialNumber: row.matched_serial,
    sku: row.sku,
    productTitle: row.product_title,
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    customerName: row.customer_name,
    sourceSystem: row.source_system,
    trackingNumber: row.tracking_number,
    deliveredAt: row.delivered_at,
    packedScannedAt: row.packed_scanned_at,
    warrantyStartsAt: clock.startsAt ? clock.startsAt.toISOString() : null,
    warrantyExpiresAt: clock.expiresAt ? clock.expiresAt.toISOString() : null,
    warrantyDays: clock.warrantyDays,
    clockBasis: clock.basis as WarrantyClockBasis | null,
    daysRemaining,
    inWarranty,
    existingClaim,
  };
}
