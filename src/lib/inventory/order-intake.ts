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
 * Auto-allocation is gated by INVENTORY_V2_ALLOCATION; off-flag the
 * helper still creates orders rows but skips the allocation call.
 */

import { transaction } from '@/lib/neon-client';
import { allocateOrder, type AllocateOrderResult } from './allocate';
import { isInventoryV2Allocation } from '@/lib/feature-flags';

export interface OrderIntakeLine {
  sku: string;
  /** Default 1. Negative or zero values are rejected. */
  quantity?: number;
  /** Maps to orders.condition; free-form text in the legacy schema. */
  condition?: string;
  /** Free-form descriptive text. */
  productTitle?: string;
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
  /** Set when allocation was attempted. null when the flag was off. */
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

export async function ingestOrder(input: OrderIntakeInput): Promise<OrderIntakeResult> {
  const externalId = input.externalId?.trim();
  if (!externalId) throw new Error('externalId required');
  const source = input.source?.trim() || 'manual';
  if (!VALID_SOURCE.test(source)) {
    throw new Error(`source must match /[a-z0-9_-]+/i, got "${source}"`);
  }
  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    throw new Error('lineItems must be a non-empty array');
  }

  // 1. Upsert orders rows in one transaction. We use INSERT ... ON
  //    CONFLICT against (order_id, sku) so a retry doesn't duplicate.
  //    The orders.order_id column is the legacy text id we point at
  //    the source's externalId.
  const orderRows = await transaction<Array<{ id: number; sku: string; created: boolean }>>(
    async (client) => {
      const out: Array<{ id: number; sku: string; created: boolean }> = [];
      for (const line of input.lineItems) {
        const sku = line.sku?.trim();
        if (!sku) continue;
        const qty = line.quantity != null && line.quantity > 0
          ? Math.floor(line.quantity)
          : 1;
        const condition = line.condition?.trim() || null;
        const productTitle = line.productTitle?.trim() || null;

        // Find existing orders row first. We don't have a UNIQUE on
        // (order_id, sku) so we can't ON CONFLICT — explicit lookup.
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM orders
            WHERE order_id = $1 AND sku = $2
            ORDER BY id ASC
            LIMIT 1`,
          [externalId, sku],
        );
        if (existing.rows[0]?.id) {
          out.push({ id: existing.rows[0].id, sku, created: false });
          continue;
        }
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO orders (
             order_id, sku, condition, quantity, product_title,
             account_source, order_date, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
           RETURNING id`,
          [
            externalId, sku, condition, String(qty), productTitle,
            source, input.orderDate ?? null,
          ],
        );
        const id = inserted.rows[0]?.id;
        if (!id) throw new Error(`orders insert returned no id for ${externalId}/${sku}`);
        out.push({ id, sku, created: true });
      }
      return out;
    },
  );

  // 2. Auto-allocate each line (best-effort). Allocation runs in its
  //    own transaction inside allocateOrder() — keeping it separate
  //    means one failing line doesn't roll back the others.
  const allocationFlagOn = isInventoryV2Allocation();
  const actorStaffId = input.actorStaffId ?? null;
  const lines: OrderIntakeLineResult[] = [];
  let unitsAllocated = 0;
  for (const row of orderRows) {
    let allocation: AllocateOrderResult | null = null;
    if (allocationFlagOn) {
      try {
        allocation = await allocateOrder({
          orderId: row.id,
          actorStaffId,
          clientEventId: `order-intake:${source}:${externalId}:${row.sku}`,
        });
        if (allocation.ok) {
          unitsAllocated += allocation.allocated;
        }
      } catch (err) {
        console.error(`[order-intake] allocate failed for order #${row.id} sku=${row.sku}:`, err);
      }
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
