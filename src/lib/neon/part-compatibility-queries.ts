import pool from '../db';

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
}): Promise<PartCompatibilityJoinedRow[]> {
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

export async function getCompatibilityById(id: number): Promise<PartCompatibilityRow | null> {
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
}): Promise<{ row: PartCompatibilityRow; created: boolean }> {
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
    [
      params.boseModelId,
      params.skuId,
      params.partRole.trim(),
      params.isOem ?? true,
      params.fit ?? 'exact',
      params.confidence ?? 'confirmed',
      params.source ?? 'manual',
      params.notes?.trim() || null,
    ],
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

  if (sets.length === 0) return getCompatibilityById(id);
  sets.push(`updated_at = NOW()`);
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
export async function deleteCompatibility(id: number): Promise<boolean> {
  const result = await pool.query(`DELETE FROM part_compatibility WHERE id = $1`, [id]);
  return (result.rowCount || 0) > 0;
}
