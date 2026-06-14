import pool from '../db';

/**
 * Standing (saved) sourcing searches — the scour watcher's work-list.
 * See migration 2026-06-13e_sourcing_saved_searches.sql + Sourcing Hub §4.3.
 */

export interface SourcingSearchRow {
  id: number;
  sku_id: number | null;
  sourcing_alert_id: number | null;
  label: string | null;
  query: string;
  sources: string[] | null;
  conditions: string[] | null;
  max_price_cents: number | null;
  cadence: string;
  is_active: boolean;
  last_run_at: string | null;
  last_hit_count: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface SourcingSearchListRow extends SourcingSearchRow {
  sku: string | null;
  product_title: string | null;
}

export async function listSourcingSearches(params: {
  activeOnly?: boolean;
  skuId?: number | null;
}): Promise<SourcingSearchListRow[]> {
  const activeOnly = params.activeOnly ?? true;
  const skuId = params.skuId ?? null;
  const result = await pool.query<SourcingSearchListRow>(
    `SELECT ss.*, sc.sku, sc.product_title
       FROM sourcing_searches ss
       LEFT JOIN sku_catalog sc ON sc.id = ss.sku_id
      WHERE ($1::boolean IS FALSE OR ss.is_active = true)
        AND ($2::int IS NULL OR ss.sku_id = $2)
      ORDER BY ss.is_active DESC, ss.updated_at DESC`,
    [activeOnly, skuId],
  );
  return result.rows;
}

export async function getSourcingSearchById(id: number): Promise<SourcingSearchRow | null> {
  const result = await pool.query<SourcingSearchRow>(
    `SELECT * FROM sourcing_searches WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export interface CreateSourcingSearchInput {
  query: string;
  label?: string | null;
  skuId?: number | null;
  sourcingAlertId?: number | null;
  sources?: string[] | null;
  conditions?: string[] | null;
  maxPriceCents?: number | null;
  cadence?: string;
  createdBy?: number | null;
}

export async function createSourcingSearch(input: CreateSourcingSearchInput): Promise<SourcingSearchRow> {
  const result = await pool.query<SourcingSearchRow>(
    `INSERT INTO sourcing_searches
       (query, label, sku_id, sourcing_alert_id, sources, conditions, max_price_cents, cadence, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      input.query.trim(),
      input.label?.trim() || null,
      input.skuId ?? null,
      input.sourcingAlertId ?? null,
      input.sources && input.sources.length ? input.sources : null,
      input.conditions && input.conditions.length ? input.conditions : null,
      input.maxPriceCents ?? null,
      (input.cadence || 'off').trim(),
      input.createdBy ?? null,
    ],
  );
  return result.rows[0];
}

export async function updateSourcingSearch(
  id: number,
  updates: {
    query?: string;
    label?: string | null;
    sources?: string[] | null;
    conditions?: string[] | null;
    maxPriceCents?: number | null;
    cadence?: string;
    isActive?: boolean;
  },
): Promise<SourcingSearchRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (updates.query !== undefined) push('query', updates.query.trim());
  if (updates.label !== undefined) push('label', updates.label?.trim() || null);
  if (updates.sources !== undefined) push('sources', updates.sources && updates.sources.length ? updates.sources : null);
  if (updates.conditions !== undefined) push('conditions', updates.conditions && updates.conditions.length ? updates.conditions : null);
  if (updates.maxPriceCents !== undefined) push('max_price_cents', updates.maxPriceCents ?? null);
  if (updates.cadence !== undefined) push('cadence', updates.cadence);
  if (updates.isActive !== undefined) push('is_active', updates.isActive);

  if (sets.length === 0) return getSourcingSearchById(id);
  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query<SourcingSearchRow>(
    `UPDATE sourcing_searches SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

/** Soft-delete (deactivate) a saved search. */
export async function deactivateSourcingSearch(id: number): Promise<SourcingSearchRow | null> {
  const result = await pool.query<SourcingSearchRow>(
    `UPDATE sourcing_searches SET is_active = false, cadence = 'off', updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Searches due for the watcher: active, scheduled, and either never run or past
 * their cadence window. One row per due search; the watcher does one scour each.
 */
export async function getDueSourcingSearches(): Promise<SourcingSearchRow[]> {
  const result = await pool.query<SourcingSearchRow>(
    `SELECT * FROM sourcing_searches
      WHERE is_active = true
        AND cadence <> 'off'
        AND (
          last_run_at IS NULL
          OR (cadence = 'daily'  AND last_run_at < NOW() - INTERVAL '20 hours')
          OR (cadence = 'weekly' AND last_run_at < NOW() - INTERVAL '6 days')
        )
      ORDER BY last_run_at NULLS FIRST
      LIMIT 200`,
  );
  return result.rows;
}

export async function markSourcingSearchRun(id: number, hitCount: number): Promise<void> {
  await pool.query(
    `UPDATE sourcing_searches SET last_run_at = NOW(), last_hit_count = $2, updated_at = NOW() WHERE id = $1`,
    [id, hitCount],
  );
}
