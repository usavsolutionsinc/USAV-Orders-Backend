/**
 * skuStockLedger repository
 * ────────────────────────────────────────────────────────────────────
 * Append-only signed-delta ledger. Authoritative since 2026-04-15:
 * sku_stock.stock and sku_stock.boxed_stock are trigger-maintained from
 * SUM(delta) per (sku, dimension). All quantity mutations must go here.
 *
 * Use append() — never write directly to sku_stock. The trigger
 * fn_recompute_sku_stock() takes care of the projection.
 */
import { db } from '@/lib/drizzle/db';
import { skuStockLedger } from '@/lib/drizzle/schema';
import type { SkuStockLedgerRow } from '@/lib/drizzle/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

/** Free-form reason codes recognized by the ledger. Prefer reasonCodeId when possible. */
export type StockLedgerReason =
  | 'RECEIVED'
  | 'SOLD'
  | 'DAMAGED'
  | 'ADJUSTMENT'
  | 'RETURNED'
  | 'SET'
  | 'CYCLE_COUNT'
  | 'INITIAL_BALANCE'
  | 'BIN_PULL'
  | 'BIN_ADD'
  | 'SWAP_IN'
  | 'SWAP_OUT'
  | 'CYCLE_COUNT_ADJ'
  | 'FOUND'
  | 'SCRAP'
  | 'THEFT'
  | 'SOLD_DIRECT'
  | 'RETURN_VENDOR'
  | 'RETURN_CUSTOMER'
  | (string & {});

export type StockLedgerDimension = 'WAREHOUSE' | 'BOXED';

export interface AppendLedgerInput {
  sku: string;
  /** Positive = added, negative = removed. Zero is rejected. */
  delta: number;
  reason: StockLedgerReason;
  /** Optional typed reason code (reason_codes.id). Preferred over free-form `reason`. */
  reasonCodeId?: number | null;
  staffId?: number | null;
  dimension?: StockLedgerDimension;
  refSerialUnitId?: number | null;
  refPackerLogId?: number | null;
  refTechLogId?: number | null;
  refSalId?: number | null;
  refOrderId?: number | null;
  refShipmentId?: number | null;
  refReceivingLineId?: number | null;
  notes?: string | null;
}

/**
 * Append a ledger row. Returns the inserted row (includes the new id, which
 * inventoryEvents callers should stash in `stockLedgerId` for cross-link).
 */
export async function appendLedgerRow(input: AppendLedgerInput): Promise<SkuStockLedgerRow> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error('appendLedgerRow: delta must be a non-zero integer');
  }
  if (!input.sku || !input.sku.trim()) {
    throw new Error('appendLedgerRow: sku is required');
  }

  const result = await db
    .insert(skuStockLedger)
    .values({
      sku: input.sku.trim(),
      delta: input.delta,
      reason: input.reason,
      reasonCodeId: input.reasonCodeId ?? null,
      staffId: input.staffId ?? null,
      dimension: input.dimension ?? 'WAREHOUSE',
      refSerialUnitId: input.refSerialUnitId ?? null,
      refPackerLogId: input.refPackerLogId ?? null,
      refTechLogId: input.refTechLogId ?? null,
      refSalId: input.refSalId ?? null,
      refOrderId: input.refOrderId ?? null,
      refShipmentId: input.refShipmentId ?? null,
      refReceivingLineId: input.refReceivingLineId ?? null,
      notes: input.notes ?? null,
    })
    .returning();

  return result[0];
}

export async function listLedgerForSku(
  sku: string,
  opts: { dimension?: StockLedgerDimension; limit?: number } = {},
): Promise<SkuStockLedgerRow[]> {
  const limit = opts.limit ?? 100;
  const filters = [eq(skuStockLedger.sku, sku)];
  if (opts.dimension) filters.push(eq(skuStockLedger.dimension, opts.dimension));

  return db
    .select()
    .from(skuStockLedger)
    .where(and(...filters))
    .orderBy(desc(skuStockLedger.createdAt), desc(skuStockLedger.id))
    .limit(limit);
}

/**
 * Current ledger sum for a SKU + dimension. Always equals
 * sku_stock.stock / .boxed_stock by trigger; querying the ledger directly
 * is the way to validate that the trigger has not drifted.
 */
export async function ledgerSum(
  sku: string,
  dimension: StockLedgerDimension = 'WAREHOUSE',
): Promise<number> {
  const row = await db.execute<{ qty: number }>(sql`
    SELECT COALESCE(SUM(delta), 0)::int AS qty
    FROM sku_stock_ledger
    WHERE sku = ${sku} AND dimension = ${dimension}
  `);
  // drizzle/neon-http returns { rows } on execute; normalize.
  const rows = ((row as unknown as { rows?: { qty: number }[] }).rows) ?? (row as unknown as { qty: number }[]);
  return rows?.[0]?.qty ?? 0;
}
