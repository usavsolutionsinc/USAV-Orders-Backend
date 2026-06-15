import pool from '../db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Standing (saved) sourcing searches — the scour watcher's work-list.
 * See migration 2026-06-13e_sourcing_saved_searches.sql + Sourcing Hub §4.3.
 *
 * Tenancy: sourcing_searches has no organization_id column yet (child-scoped in
 * docs/tenancy/org-id-coverage.generated.md); it is scoped via its sku_catalog
 * parent (sku_id → sku_catalog.organization_id) where a SKU is present, and
 * otherwise relies on the per-request app.current_org GUC. Functions reachable
 * from out-of-fileset callers (the scour-watch job, the [id] routes) take an
 * OPTIONAL orgId and keep byte-identical raw-pool behavior when it is omitted.
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
}, orgId: OrgId): Promise<SourcingSearchListRow[]> {
  const activeOnly = params.activeOnly ?? true;
  const skuId = params.skuId ?? null;
  // Scope to this org's SKUs; SKU-less searches have no anchor and rely on GUC.
  const result = await tenantQuery<SourcingSearchListRow>(
    orgId,
    `SELECT ss.*, sc.sku, sc.product_title
       FROM sourcing_searches ss
       LEFT JOIN sku_catalog sc ON sc.id = ss.sku_id
      WHERE ($1::boolean IS FALSE OR ss.is_active = true)
        AND ($2::int IS NULL OR ss.sku_id = $2)
        AND (ss.sku_id IS NULL OR sc.organization_id = $3)
      ORDER BY ss.is_active DESC, ss.updated_at DESC`,
    [activeOnly, skuId, orgId],
  );
  return result.rows;
}

export async function getSourcingSearchById(id: number, orgId?: OrgId): Promise<SourcingSearchRow | null> {
  // Optional orgId: the [id] routes (out of fileset) still call without one.
  if (orgId) {
    const result = await tenantQuery<SourcingSearchRow>(
      orgId,
      `SELECT ss.* FROM sourcing_searches ss
         LEFT JOIN sku_catalog sc ON sc.id = ss.sku_id
        WHERE ss.id = $1
          AND (ss.sku_id IS NULL OR sc.organization_id = $2)
        LIMIT 1`,
      [id, orgId],
    );
    return result.rows[0] ?? null;
  }
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

export async function createSourcingSearch(input: CreateSourcingSearchInput, orgId: OrgId): Promise<SourcingSearchRow> {
  const result = await tenantQuery<SourcingSearchRow>(
    orgId,
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
  orgId?: OrgId,
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

  if (sets.length === 0) return getSourcingSearchById(id, orgId);
  sets.push(`updated_at = NOW()`);
  values.push(id);
  const idIdx = idx;

  // Optional orgId: the [id] route (out of fileset) calls without one
  // (byte-identical raw-pool path). With orgId, scope the UPDATE to this org's
  // SKUs (or SKU-less rows under the GUC) so a cross-tenant id never matches.
  if (orgId) {
    values.push(orgId);
    const result = await tenantQuery<SourcingSearchRow>(
      orgId,
      `UPDATE sourcing_searches ss SET ${sets.join(', ')}
        WHERE ss.id = $${idIdx}
          AND (
            ss.sku_id IS NULL
            OR EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.id = ss.sku_id AND sc.organization_id = $${idIdx + 1})
          )
        RETURNING ss.*`,
      values,
    );
    return result.rows[0] ?? null;
  }

  const result = await pool.query<SourcingSearchRow>(
    `UPDATE sourcing_searches SET ${sets.join(', ')} WHERE id = $${idIdx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

/** Soft-delete (deactivate) a saved search. */
export async function deactivateSourcingSearch(id: number, orgId?: OrgId): Promise<SourcingSearchRow | null> {
  // Optional orgId: the [id] route (out of fileset) calls without one.
  if (orgId) {
    const result = await tenantQuery<SourcingSearchRow>(
      orgId,
      `UPDATE sourcing_searches ss SET is_active = false, cadence = 'off', updated_at = NOW()
        WHERE ss.id = $1
          AND (
            ss.sku_id IS NULL
            OR EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.id = ss.sku_id AND sc.organization_id = $2)
          )
        RETURNING ss.*`,
      [id, orgId],
    );
    return result.rows[0] ?? null;
  }
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
export async function getDueSourcingSearches(orgId?: OrgId): Promise<SourcingSearchRow[]> {
  // Optional orgId: the scour-watch cron (out of fileset) sweeps ALL orgs' due
  // searches and calls without one — keep that cross-org behavior byte-identical
  // when omitted. With orgId, scope to this org's SKUs (or SKU-less rows / GUC).
  if (orgId) {
    const result = await tenantQuery<SourcingSearchRow>(
      orgId,
      `SELECT ss.* FROM sourcing_searches ss
         LEFT JOIN sku_catalog sc ON sc.id = ss.sku_id
        WHERE ss.is_active = true
          AND ss.cadence <> 'off'
          AND (
            ss.last_run_at IS NULL
            OR (ss.cadence = 'daily'  AND ss.last_run_at < NOW() - INTERVAL '20 hours')
            OR (ss.cadence = 'weekly' AND ss.last_run_at < NOW() - INTERVAL '6 days')
          )
          AND (ss.sku_id IS NULL OR sc.organization_id = $1)
        ORDER BY ss.last_run_at NULLS FIRST
        LIMIT 200`,
      [orgId],
    );
    return result.rows;
  }
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

export async function markSourcingSearchRun(id: number, hitCount: number, orgId?: OrgId): Promise<void> {
  // Optional orgId: cron + [id]/run route (out of fileset) call without one.
  if (orgId) {
    await tenantQuery(
      orgId,
      `UPDATE sourcing_searches ss SET last_run_at = NOW(), last_hit_count = $2, updated_at = NOW()
        WHERE ss.id = $1
          AND (
            ss.sku_id IS NULL
            OR EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.id = ss.sku_id AND sc.organization_id = $3)
          )`,
      [id, hitCount, orgId],
    );
    return;
  }
  await pool.query(
    `UPDATE sourcing_searches SET last_run_at = NOW(), last_hit_count = $2, updated_at = NOW() WHERE id = $1`,
    [id, hitCount],
  );
}
