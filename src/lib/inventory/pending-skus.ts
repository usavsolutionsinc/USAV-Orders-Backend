/**
 * pending-skus.ts — the "create in Zoho" to-do queue (relational-reuse plan P3 §7).
 * ────────────────────────────────────────────────────────────────────
 * When an operational SKU can't resolve to sku_catalog (because the product
 * hasn't been created in Zoho yet — Zoho is the SoT), we record it here instead
 * of silently dropping it or auto-creating a local catalog row. One row per
 * normalized SKU; `occurrences` tracks how often it's blocking work.
 *
 * Resolution is automatic: the `trg_resolve_pending_sku` trigger on sku_catalog
 * stamps `sku_catalog_id` and flips status → CREATED the moment the matching
 * Zoho SKU lands. The queue key and the trigger both normalize via the SQL
 * `fn_normalize_sku()` so they can't drift.
 *
 * Pairing entry point: `resolveSkuCatalogIdOrQueue()` — resolve through the
 * existing crosswalk chain, and on a miss enqueue + return null (caller leaves
 * the operational row's sku_catalog_id NULL = unmatched).
 */

import pool from '@/lib/db';
import type { PoolClient } from 'pg';
import { resolveSkuCatalogId } from '@/lib/neon/sku-catalog-queries';

export type PendingSkuStatus = 'PENDING' | 'CREATED' | 'IGNORED' | 'DUPLICATE';
export type PendingSkuSource = 'sku_stock' | 'orders' | 'receiving' | 'scan' | 'ledger' | (string & {});

export interface PendingSkuRow {
  id: number;
  normalized_sku: string;
  raw_sku: string;
  status: PendingSkuStatus;
  occurrences: number;
  first_source: string | null;
  suggested_title: string | null;
  sku_catalog_id: number | null;
  resolved_at: string | null;
  assigned_to: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueuePendingSkuInput {
  rawSku: string;
  source?: PendingSkuSource | null;
  suggestedTitle?: string | null;
}

/**
 * Record an unmatched SKU in the queue (idempotent). On a repeat sighting it
 * bumps `occurrences` and refreshes a missing title/source rather than
 * duplicating. Returns the queue row, or null for an empty/invalid SKU. A
 * PENDING row is upserted; rows already CREATED/IGNORED/DUPLICATE are left as-is
 * (only occurrences is bumped) so steward decisions stick.
 */
export async function queuePendingSku(
  input: QueuePendingSkuInput,
  executor: Pick<PoolClient, 'query'> = pool,
): Promise<PendingSkuRow | null> {
  const raw = (input.rawSku ?? '').trim();
  if (!raw) return null;

  const result = await executor.query<PendingSkuRow>(
    `INSERT INTO pending_skus (normalized_sku, raw_sku, first_source, suggested_title)
     VALUES (fn_normalize_sku($1), $1, $2, $3)
     ON CONFLICT (normalized_sku) DO UPDATE SET
       occurrences     = pending_skus.occurrences + 1,
       first_source    = COALESCE(pending_skus.first_source, EXCLUDED.first_source),
       suggested_title = COALESCE(pending_skus.suggested_title, EXCLUDED.suggested_title),
       updated_at      = now()
     RETURNING *`,
    [raw, input.source ?? null, input.suggestedTitle ?? null],
  );
  return result.rows[0] ?? null;
}

export interface ResolveOrQueueInput {
  sku?: string | null;
  itemNumber?: string | null;
  source?: PendingSkuSource | null;
  suggestedTitle?: string | null;
}

/**
 * Resolve a SKU to its canonical sku_catalog_id through the existing crosswalk
 * chain (direct → platform xref). On a miss, enqueue it in pending_skus (so it
 * becomes a "create in Zoho" to-do) and return null. The caller leaves the
 * operational row's sku_catalog_id NULL — that NULL is the unmatched state.
 *
 * Unlike `resolveOrCreateSkuCatalogId`, this never fabricates a local catalog
 * row: Zoho stays the source of truth, and creation happens deliberately there.
 */
export async function resolveSkuCatalogIdOrQueue(
  input: ResolveOrQueueInput,
): Promise<{ skuCatalogId: number | null; queued: boolean }> {
  const id = await resolveSkuCatalogId(input.sku ?? null, input.itemNumber ?? null);
  if (id) return { skuCatalogId: id, queued: false };

  const raw = (input.sku ?? '').trim();
  if (!raw) return { skuCatalogId: null, queued: false };

  await queuePendingSku({ rawSku: raw, source: input.source ?? null, suggestedTitle: input.suggestedTitle ?? null });
  return { skuCatalogId: null, queued: true };
}

export interface ListPendingSkusOptions {
  status?: PendingSkuStatus;
  limit?: number;
}

/** The to-do list — PENDING rows ordered by how often they block work. */
export async function listPendingSkus(opts: ListPendingSkusOptions = {}): Promise<PendingSkuRow[]> {
  const status = opts.status ?? 'PENDING';
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const result = await pool.query<PendingSkuRow>(
    `SELECT * FROM pending_skus
      WHERE status = $1
      ORDER BY occurrences DESC, created_at ASC
      LIMIT $2`,
    [status, limit],
  );
  return result.rows;
}

/** Steward action: drop a junk SKU from the to-do list (e.g. 'No data', typo). */
export async function ignorePendingSku(id: number, notes?: string | null): Promise<PendingSkuRow | null> {
  const result = await pool.query<PendingSkuRow>(
    `UPDATE pending_skus
        SET status = 'IGNORED', notes = COALESCE($2, notes), updated_at = now()
      WHERE id = $1 AND status = 'PENDING'
      RETURNING *`,
    [id, notes ?? null],
  );
  return result.rows[0] ?? null;
}

/**
 * Backstop reconcile for an already-existing catalog row (the trigger covers
 * new INSERTs; this catches SKUs created before they were queued, or a sweep).
 * Resolves any PENDING rows whose normalized form matches the given catalog sku.
 */
export async function reconcilePendingForCatalog(
  catalogId: number,
  catalogSku: string,
): Promise<number> {
  const result = await pool.query(
    `UPDATE pending_skus
        SET sku_catalog_id = $1, status = 'CREATED', resolved_at = now(), updated_at = now()
      WHERE status = 'PENDING' AND normalized_sku = fn_normalize_sku($2)`,
    [catalogId, catalogSku],
  );
  return result.rowCount ?? 0;
}
