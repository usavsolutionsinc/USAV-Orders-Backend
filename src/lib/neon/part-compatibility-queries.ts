import pool from '../db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface PartCompatibilityRow {
  id: number;
  bose_model_id: number;
  sku_id: number;
  part_role: string;
  is_oem: boolean;
  fit: string;
  confidence: string;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Joined shape for list views (adds the human labels both endpoints carry). */
export interface PartCompatibilityJoinedRow extends PartCompatibilityRow {
  model_number: string;
  model_name: string;
  sku: string;
  product_title: string;
}

export async function listCompatibility(params: {
  boseModelId?: number | null;
  skuId?: number | null;
}, orgId?: OrgId): Promise<PartCompatibilityJoinedRow[]> {
  // part_compatibility has NO organization_id column — it is scoped through its
  // org-bearing parent sku_catalog (pc.sku_id = sc.id, integer surrogate-PK
  // join). When orgId is present we run GUC-wrapped and add the explicit
  // sc.organization_id predicate; when omitted, behavior is byte-identical to
  // the original raw-pool query.
  if (orgId) {
    const result = await tenantQuery<PartCompatibilityJoinedRow>(
      orgId,
      `SELECT pc.*, bm.model_number, bm.model_name, sc.sku, sc.product_title
         FROM part_compatibility pc
         JOIN bose_models bm ON bm.id = pc.bose_model_id
         JOIN sku_catalog sc ON sc.id = pc.sku_id
        WHERE ($1::int IS NULL OR pc.bose_model_id = $1)
          AND ($2::int IS NULL OR pc.sku_id = $2)
          AND sc.organization_id = $3
        ORDER BY bm.model_name, pc.part_role, sc.product_title`,
      [params.boseModelId ?? null, params.skuId ?? null, orgId],
    );
    return result.rows;
  }
  const result = await pool.query<PartCompatibilityJoinedRow>(
    `SELECT pc.*, bm.model_number, bm.model_name, sc.sku, sc.product_title
       FROM part_compatibility pc
       JOIN bose_models bm ON bm.id = pc.bose_model_id
       JOIN sku_catalog sc ON sc.id = pc.sku_id
      WHERE ($1::int IS NULL OR pc.bose_model_id = $1)
        AND ($2::int IS NULL OR pc.sku_id = $2)
      ORDER BY bm.model_name, pc.part_role, sc.product_title`,
    [params.boseModelId ?? null, params.skuId ?? null],
  );
  return result.rows;
}

export async function getCompatibilityById(id: number, orgId?: OrgId): Promise<PartCompatibilityRow | null> {
  // No org column on part_compatibility: ownership is asserted via the parent
  // sku_catalog row (EXISTS subquery). A row owned by another tenant returns
  // null → caller maps to 404 (never 403). Omitting orgId keeps the original
  // raw-pool behavior byte-identical.
  if (orgId) {
    const result = await tenantQuery<PartCompatibilityRow>(
      orgId,
      `SELECT pc.* FROM part_compatibility pc
        WHERE pc.id = $1
          AND EXISTS (
            SELECT 1 FROM sku_catalog sc
             WHERE sc.id = pc.sku_id AND sc.organization_id = $2
          )
        LIMIT 1`,
      [id, orgId],
    );
    return result.rows[0] ?? null;
  }
  const result = await pool.query<PartCompatibilityRow>(
    `SELECT * FROM part_compatibility WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Create or update a compatibility edge. The DB unique key
 * (bose_model_id, sku_id, part_role) makes a repeat call idempotent — it
 * refreshes the edge's attributes rather than inserting a duplicate.
 * Throws on FK violation (unknown model or sku) — caller maps 23503 → 400.
 */
export async function upsertCompatibility(params: {
  boseModelId: number;
  skuId: number;
  partRole: string;
  isOem?: boolean;
  fit?: string;
  confidence?: string;
  source?: string;
  notes?: string | null;
}, orgId?: OrgId): Promise<{ row: PartCompatibilityRow; created: boolean }> {
  const args = [
    params.boseModelId,
    params.skuId,
    params.partRole.trim(),
    params.isOem ?? true,
    params.fit ?? 'exact',
    params.confidence ?? 'confirmed',
    params.source ?? 'manual',
    params.notes?.trim() || null,
  ];

  // part_compatibility has no organization_id to stamp — tenant ownership is
  // gated on the target sku_id belonging to the org (INSERT ... SELECT WHERE
  // EXISTS against the org-bearing parent sku_catalog). A cross-tenant skuId
  // yields zero rows; we surface that as a 23503-shaped FK error so the caller
  // keeps mapping it to 400 (unknown sku for this tenant), preserving the
  // documented contract. The ON CONFLICT key (bose_model_id, sku_id, part_role)
  // is global; idempotent refresh is unchanged.
  if (orgId) {
    const result = await withTenantTransaction(orgId, async (client) => {
      return client.query<PartCompatibilityRow & { _created: boolean }>(
        `INSERT INTO part_compatibility
           (bose_model_id, sku_id, part_role, is_oem, fit, confidence, source, notes)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
          WHERE EXISTS (
            SELECT 1 FROM sku_catalog sc
             WHERE sc.id = $2 AND sc.organization_id = $9
          )
         ON CONFLICT (bose_model_id, sku_id, part_role) DO UPDATE SET
           is_oem     = EXCLUDED.is_oem,
           fit        = EXCLUDED.fit,
           confidence = EXCLUDED.confidence,
           source     = EXCLUDED.source,
           notes      = COALESCE(EXCLUDED.notes, part_compatibility.notes),
           updated_at = NOW()
         RETURNING *, (xmax = 0) AS _created`,
        [...args, orgId],
      );
    });
    const hit = result.rows[0];
    if (!hit) {
      // No sku_catalog row for this org/skuId → mimic the FK-violation path the
      // raw query would take on an unknown sku so callers map it to 400.
      const err = new Error('part_compatibility: sku_id not found for organization') as Error & { code?: string };
      err.code = '23503';
      throw err;
    }
    const { _created, ...row } = hit;
    return { row, created: _created };
  }

  const result = await pool.query<PartCompatibilityRow & { _created: boolean }>(
    `INSERT INTO part_compatibility
       (bose_model_id, sku_id, part_role, is_oem, fit, confidence, source, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (bose_model_id, sku_id, part_role) DO UPDATE SET
       is_oem     = EXCLUDED.is_oem,
       fit        = EXCLUDED.fit,
       confidence = EXCLUDED.confidence,
       source     = EXCLUDED.source,
       notes      = COALESCE(EXCLUDED.notes, part_compatibility.notes),
       updated_at = NOW()
     RETURNING *, (xmax = 0) AS _created`,
    args,
  );
  const { _created, ...row } = result.rows[0];
  return { row, created: _created };
}

export async function updateCompatibility(
  id: number,
  updates: {
    partRole?: string;
    isOem?: boolean;
    fit?: string;
    confidence?: string;
    source?: string;
    notes?: string | null;
  },
  orgId?: OrgId,
): Promise<PartCompatibilityRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (updates.partRole !== undefined) push('part_role', updates.partRole.trim());
  if (updates.isOem !== undefined) push('is_oem', updates.isOem);
  if (updates.fit !== undefined) push('fit', updates.fit);
  if (updates.confidence !== undefined) push('confidence', updates.confidence);
  if (updates.source !== undefined) push('source', updates.source);
  if (updates.notes !== undefined) push('notes', updates.notes?.trim() || null);

  if (sets.length === 0) return getCompatibilityById(id, orgId);
  sets.push(`updated_at = NOW()`);

  // No org column to filter on directly: gate the UPDATE on the parent
  // sku_catalog row belonging to this org (EXISTS subquery). A cross-tenant id
  // matches nothing → null → caller maps to 404. Omitting orgId keeps the
  // original raw-pool UPDATE byte-identical.
  if (orgId) {
    const idIdx = idx++;
    values.push(id);
    const orgIdx = idx;
    values.push(orgId);
    const result = await withTenantTransaction(orgId, async (client) =>
      client.query<PartCompatibilityRow>(
        `UPDATE part_compatibility pc SET ${sets.join(', ')}
          WHERE pc.id = $${idIdx}
            AND EXISTS (
              SELECT 1 FROM sku_catalog sc
               WHERE sc.id = pc.sku_id AND sc.organization_id = $${orgIdx}
            )
          RETURNING pc.*`,
        values,
      ),
    );
    return result.rows[0] ?? null;
  }

  values.push(id);
  const result = await pool.query<PartCompatibilityRow>(
    `UPDATE part_compatibility SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

/**
 * Hard-delete an edge. Unlike sku_catalog (which carries downstream
 * references and is soft-deleted), a compatibility edge is pure relationship
 * data — once removed there's nothing to preserve, and the before-state is
 * captured in the audit log by the caller.
 */
export async function deleteCompatibility(id: number, orgId?: OrgId): Promise<boolean> {
  // No org column: gate the DELETE on the parent sku_catalog row belonging to
  // this org (EXISTS subquery). A cross-tenant id deletes nothing → false →
  // caller maps to 404. Omitting orgId keeps the original raw-pool DELETE
  // byte-identical.
  if (orgId) {
    const result = await withTenantTransaction(orgId, async (client) =>
      client.query(
        `DELETE FROM part_compatibility pc
          WHERE pc.id = $1
            AND EXISTS (
              SELECT 1 FROM sku_catalog sc
               WHERE sc.id = pc.sku_id AND sc.organization_id = $2
            )`,
        [id, orgId],
      ),
    );
    return (result.rowCount || 0) > 0;
  }
  const result = await pool.query(`DELETE FROM part_compatibility WHERE id = $1`, [id]);
  return (result.rowCount || 0) > 0;
}
