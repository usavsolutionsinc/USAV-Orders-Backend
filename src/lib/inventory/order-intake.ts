/**
 * order-intake.ts
 * ────────────────────────────────────────────────────────────────────
 * Generic "an order arrived from somewhere — ensure orders rows and
 * auto-allocate" helper. The actual webhook routes (Zoho today, eBay
 * tomorrow, manual cron whenever) normalize their source payload to
 * the OrderIntake shape below and call ingestOrder().
 *
 * Idempotent: orders rows are upserted by (zoho_so_id-style external_id,
 * sku) — re-running the same intake is a no-op for already-created
 * rows and a re-attempt for any line that previously failed to
 * allocate.
 *
 * Auto-allocation runs unconditionally: each created/looked-up order line
 * is passed to allocateOrder() (best-effort per line).
 */

import type { PoolClient } from 'pg';
import { transaction } from '@/lib/neon-client';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { allocateOrder, type AllocateOrderResult } from './allocate';

export interface OrderIntakeLine {
  sku: string;
  /** Default 1. Negative or zero values are rejected. */
  quantity?: number;
  /** Maps to orders.condition; free-form text in the legacy schema. */
  condition?: string;
  /** Free-form descriptive text. */
  productTitle?: string;
  /** Realized sale price for this line. Maps to orders.sale_amount; null when source omits it. */
  saleAmount?: number | null;
  /** ISO currency for saleAmount. Maps to orders.currency; defaults to 'USD'. */
  currency?: string | null;
}

export interface OrderIntakeInput {
  /** Stable id from the source system (e.g. Zoho SO id). Used for upsert dedupe. */
  externalId: string;
  /** Free-form source tag ('zoho','ebay','manual'). Recorded on orders.account_source. */
  source: string;
  customerExternalId?: string | null;
  orderDate?: string | null;
  lineItems: OrderIntakeLine[];
  /** Optional staff id for auto-allocation attribution. */
  actorStaffId?: number | null;
}

export interface OrderIntakeLineResult {
  sku: string;
  orderId: number;
  created: boolean;
  /** Set when allocation was attempted. null when the allocation call threw. */
  allocation: AllocateOrderResult | null;
}

export interface OrderIntakeResult {
  externalId: string;
  source: string;
  lines: OrderIntakeLineResult[];
  /** Count of lines that came in or were already present. */
  totalLines: number;
  /** Count of lines that newly allocated this run (sum of unit counts). */
  unitsAllocated: number;
}

const VALID_SOURCE = /^[a-z0-9_-]+$/i;

/**
 * Tenancy: pass `orgId` to run the orders upsert inside a tenant-scoped
 * transaction (`withTenantTransaction`, which sets the `app.current_org` GUC via
 * SET LOCAL) and to stamp `organization_id` explicitly on inserted `orders` rows
 * (tenant-owned, usav-fallback default — an unstamped insert would silently
 * misroute to USAV). The `orgId` is also threaded into `allocateOrder()` so the
 * downstream allocation + `order_unit_allocations` insert run org-scoped. Omitting
 * `orgId` keeps the legacy raw-pool `transaction` path byte-identical — every
 * existing caller that doesn't yet thread org behaves exactly as before.
 */
export async function ingestOrder(input: OrderIntakeInput, orgId?: OrgId): Promise<OrderIntakeResult> {
  const externalId = input.externalId?.trim();
  if (!externalId) throw new Error('externalId required');
  const source = input.source?.trim() || 'manual';
  if (!VALID_SOURCE.test(source)) {
    throw new Error(`source must match /[a-z0-9_-]+/i, got "${source}"`);
  }
  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    throw new Error('lineItems must be a non-empty array');
  }

  // 1. Upsert orders rows in one transaction. We use an explicit lookup +
  //    INSERT (no UNIQUE on (order_id, sku) to ON CONFLICT against) so a retry
  //    doesn't duplicate. The orders.order_id column is the legacy text id we
  //    point at the source's externalId.
  //
  //    Tenancy: when orgId is supplied the org-scoped query carries an explicit
  //    organization_id predicate on the lookup and stamps it on the INSERT
  //    (orders is tenant-owned). When omitted the SQL is the legacy form.
  const upsertOrders = async (
    client: Pick<PoolClient, 'query'>,
  ): Promise<Array<{ id: number; sku: string; created: boolean }>> => {
    const out: Array<{ id: number; sku: string; created: boolean }> = [];
    for (const line of input.lineItems) {
      const sku = line.sku?.trim();
      if (!sku) continue;
      const qty = line.quantity != null && line.quantity > 0
        ? Math.floor(line.quantity)
        : 1;
      const condition = line.condition?.trim() || null;
      const productTitle = line.productTitle?.trim() || null;
      const saleAmount =
        line.saleAmount != null && Number.isFinite(line.saleAmount)
          ? line.saleAmount
          : null;
      const currency = line.currency?.trim() || 'USD';

      // Find existing orders row first. We don't have a UNIQUE on
      // (order_id, sku) so we can't ON CONFLICT — explicit lookup.
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM orders
          WHERE order_id = $1 AND sku = $2
            ${orgId ? 'AND organization_id = $3' : ''}
          ORDER BY id ASC
          LIMIT 1`,
        orgId ? [externalId, sku, orgId] : [externalId, sku],
      );
      if (existing.rows[0]?.id) {
        out.push({ id: existing.rows[0].id, sku, created: false });
        continue;
      }
      const inserted = await client.query<{ id: number }>(
        orgId
          ? `INSERT INTO orders (
               order_id, sku, condition, quantity, product_title,
               account_source, order_date, sale_amount, currency, status,
               organization_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10::uuid)
             RETURNING id`
          : `INSERT INTO orders (
               order_id, sku, condition, quantity, product_title,
               account_source, order_date, sale_amount, currency, status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')
             RETURNING id`,
        orgId
          ? [
              externalId, sku, condition, String(qty), productTitle,
              source, input.orderDate ?? null, saleAmount, currency, orgId,
            ]
          : [
              externalId, sku, condition, String(qty), productTitle,
              source, input.orderDate ?? null, saleAmount, currency,
            ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error(`orders insert returned no id for ${externalId}/${sku}`);
      out.push({ id, sku, created: true });
    }
    return out;
  };

  const orderRows = orgId
    ? await withTenantTransaction(orgId, (client) => upsertOrders(client))
    : await transaction((client) => upsertOrders(client));

  // 2. Auto-allocate each line (best-effort). Allocation runs in its
  //    own transaction inside allocateOrder() — keeping it separate
  //    means one failing line doesn't roll back the others.
  const actorStaffId = input.actorStaffId ?? null;
  const lines: OrderIntakeLineResult[] = [];
  let unitsAllocated = 0;
  for (const row of orderRows) {
    let allocation: AllocateOrderResult | null = null;
    try {
      allocation = await allocateOrder({
        orderId: row.id,
        actorStaffId,
        clientEventId: `order-intake:${source}:${externalId}:${row.sku}`,
      }, orgId);
      if (allocation.ok) {
        unitsAllocated += allocation.allocated;
      }
    } catch (err) {
      console.error(`[order-intake] allocate failed for order #${row.id} sku=${row.sku}:`, err);
    }
    lines.push({
      sku: row.sku,
      orderId: row.id,
      created: row.created,
      allocation,
    });
  }

  return {
    externalId,
    source,
    lines,
    totalLines: lines.length,
    unitsAllocated,
  };
}
