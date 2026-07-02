/**
 * inbound_purchase_order_mirror — the ONE read-only reconcile mirror for all
 * inbound sources (Zoho, eBay, …). Not a second queue; a place upstream sync
 * lands the source-of-record snapshot the Incoming query joins to decide
 * accounting closure. Legacy zoho_po_mirror keeps running; Zoho sync dual-writes
 * both until readers cut over (plan §3.3, §3.9).
 *
 * Deps-injected `query` (default tenantQuery) so tests run DB-free — same shape
 * as src/lib/receiving/facts/store.ts.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { assertRegisteredInboundSource, type InboundSourceType } from './source-registry';

/** Upstream statuses that mean "this purchase is done" → drop it off Incoming. */
const MIRROR_TERMINAL_STATUSES = ['cancelled', 'canceled', 'closed', 'received', 'completed', 'refunded', 'returned'] as const;

/**
 * SQL fragment (references the `rl` alias) — TRUE when a line's inbound mirror is
 * NOT terminal for `source`, i.e. the upstream order is still open, so the line
 * stays in Incoming. The polymorphic analogue of NOT_ZOHO_RECEIVED_PREDICATE;
 * one query interface for every source (plan §6.1). `source` is a code constant
 * validated against the registry, so the interpolation is injection-safe.
 */
export function notInboundMirrorTerminalPredicate(source: InboundSourceType): string {
  assertRegisteredInboundSource(source);
  const list = MIRROR_TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ');
  return `NOT EXISTS (
    SELECT 1 FROM inbound_purchase_order_mirror ipm
     WHERE ipm.organization_id = rl.organization_id
       AND ipm.source_type = '${source}'
       AND ipm.source_order_id = rl.source_order_id
       AND lower(COALESCE(ipm.status, '')) IN (${list})
  )`;
}

export interface MirrorDeps {
  query: typeof tenantQuery;
}

const defaultDeps: MirrorDeps = { query: tenantQuery };

export interface UpsertMirrorInput {
  sourceType: string;
  sourceOrderId: string;
  platformAccountId?: number | null;
  orderNumber?: string | null;
  vendorOrSellerName?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  poDate?: string | null; // ISO date
  expectedDeliveryDate?: string | null; // ISO date
  trackingNumber?: string | null;
  carrierCode?: string | null;
  lineItems?: unknown[];
  rawPayload?: unknown;
  lastModifiedAt?: string | null; // ISO timestamptz
}

export interface MirrorRow {
  id: number;
  source_type: string;
  source_order_id: string;
  platform_account_id: number | null;
  order_number: string | null;
  vendor_or_seller_name: string | null;
  status: string | null;
  payment_status: string | null;
  tracking_number: string | null;
  carrier_code: string | null;
}

/**
 * Upsert an upstream reconcile snapshot. Idempotent on
 * (org, source_type, source_order_id). Queryable business facts are real columns;
 * the vendor-specific tail rides in raw_payload.
 */
export async function upsertInboundMirror(
  orgId: OrgId,
  input: UpsertMirrorInput,
  deps: MirrorDeps = defaultDeps,
): Promise<MirrorRow> {
  assertRegisteredInboundSource(input.sourceType);
  const r = await deps.query<MirrorRow>(
    orgId,
    `INSERT INTO inbound_purchase_order_mirror (
        organization_id, source_type, source_order_id, platform_account_id,
        order_number, vendor_or_seller_name, status, payment_status,
        po_date, expected_delivery_date, tracking_number, carrier_code,
        line_items, raw_payload, last_modified_at, synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              $13::jsonb, $14::jsonb, $15, now())
      ON CONFLICT (organization_id, source_type, source_order_id)
      DO UPDATE SET
        platform_account_id    = COALESCE(EXCLUDED.platform_account_id, inbound_purchase_order_mirror.platform_account_id),
        order_number           = EXCLUDED.order_number,
        vendor_or_seller_name  = EXCLUDED.vendor_or_seller_name,
        status                 = EXCLUDED.status,
        payment_status         = EXCLUDED.payment_status,
        po_date                = EXCLUDED.po_date,
        expected_delivery_date = EXCLUDED.expected_delivery_date,
        tracking_number        = EXCLUDED.tracking_number,
        carrier_code           = EXCLUDED.carrier_code,
        line_items             = EXCLUDED.line_items,
        raw_payload            = EXCLUDED.raw_payload,
        last_modified_at       = EXCLUDED.last_modified_at,
        synced_at              = now(),
        updated_at             = now()
      RETURNING id, source_type, source_order_id, platform_account_id, order_number,
                vendor_or_seller_name, status, payment_status, tracking_number, carrier_code`,
    [
      orgId,
      input.sourceType,
      input.sourceOrderId,
      input.platformAccountId ?? null,
      input.orderNumber ?? null,
      input.vendorOrSellerName ?? null,
      input.status ?? null,
      input.paymentStatus ?? null,
      input.poDate ?? null,
      input.expectedDeliveryDate ?? null,
      input.trackingNumber ?? null,
      input.carrierCode ?? null,
      JSON.stringify(input.lineItems ?? []),
      input.rawPayload != null ? JSON.stringify(input.rawPayload) : null,
      input.lastModifiedAt ?? null,
    ],
  );
  return r.rows[0];
}

/** Read one mirror snapshot, or null. */
export async function getInboundMirror(
  orgId: OrgId,
  sourceType: string,
  sourceOrderId: string,
  deps: MirrorDeps = defaultDeps,
): Promise<MirrorRow | null> {
  assertRegisteredInboundSource(sourceType);
  const r = await deps.query<MirrorRow>(
    orgId,
    `SELECT id, source_type, source_order_id, platform_account_id, order_number,
            vendor_or_seller_name, status, payment_status, tracking_number, carrier_code
       FROM inbound_purchase_order_mirror
      WHERE organization_id = $1 AND source_type = $2 AND source_order_id = $3`,
    [orgId, sourceType, sourceOrderId],
  );
  return r.rows[0] ?? null;
}
