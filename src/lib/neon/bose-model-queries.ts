import pool from '../db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface BoseModelRow {
  id: number;
  model_number: string;
  model_name: string;
  family: string | null;
  product_type: string | null;
  release_year: number | null;
  eol_date: string | null;
  image_url: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BoseModelListRow extends BoseModelRow {
  compat_count: number;
}

/** A compatible part resolved against live stock + lifecycle + open alerts. */
export interface CompatiblePartRow {
  compatibility_id: number;
  sku_id: number;
  sku: string;
  product_title: string;
  image_url: string | null;
  part_role: string;
  is_oem: boolean;
  fit: string;
  confidence: string;
  lifecycle_status: string;
  on_hand: number;
  open_alert_count: number;
}

// ─── List (with compatibility counts) ───────────────────────────────────────

export async function getBoseModelList(params: {
  q?: string;
  family?: string | null;
  limit?: number;
  offset?: number;
}, orgId?: OrgId): Promise<{ items: BoseModelListRow[]; total: number }> {
  const search = (params.q || '').trim();
  const family = (params.family || '').trim();
  const limit = Math.min(params.limit || 100, 500);
  const offset = params.offset || 0;

  const listSql =
    `SELECT bm.*, COUNT(pc.id)::int AS compat_count
       FROM bose_models bm
       LEFT JOIN part_compatibility pc ON pc.bose_model_id = bm.id
      WHERE bm.is_active = true
        AND ($1 = '' OR bm.model_number ILIKE '%' || $1 || '%' OR bm.model_name ILIKE '%' || $1 || '%')
        AND ($2 = '' OR bm.family = $2)
      GROUP BY bm.id
      ORDER BY bm.model_name, bm.model_number
      LIMIT $3 OFFSET $4`;
  const countSql =
    `SELECT COUNT(*)::int AS total
       FROM bose_models bm
      WHERE bm.is_active = true
        AND ($1 = '' OR bm.model_number ILIKE '%' || $1 || '%' OR bm.model_name ILIKE '%' || $1 || '%')
        AND ($2 = '' OR bm.family = $2)`;

  // bose_models / part_compatibility carry no organization_id column (see
  // docs/tenancy/org-id-coverage.generated.md → reference-decide). When orgId is
  // present we GUC-wrap via tenantQuery so RLS can backstop once a column lands;
  // the integer surrogate-PK join (pc.bose_model_id = bm.id) is org-safe bare.
  const result = orgId
    ? await tenantQuery<BoseModelListRow>(orgId, listSql, [search, family, limit, offset])
    : await pool.query<BoseModelListRow>(listSql, [search, family, limit, offset]);

  const countResult = orgId
    ? await tenantQuery<{ total: number }>(orgId, countSql, [search, family])
    : await pool.query<{ total: number }>(countSql, [search, family]);

  return { items: result.rows, total: countResult.rows[0]?.total || 0 };
}

export async function getBoseModelById(id: number, orgId?: OrgId): Promise<BoseModelRow | null> {
  const sql = `SELECT * FROM bose_models WHERE id = $1 LIMIT 1`;
  // bose_models has no organization_id (reference-decide); GUC-wrap only.
  const result = orgId
    ? await tenantQuery<BoseModelRow>(orgId, sql, [id])
    : await pool.query<BoseModelRow>(sql, [id]);
  return result.rows[0] ?? null;
}

export async function getBoseModelByModelNumber(modelNumber: string, orgId?: OrgId): Promise<BoseModelRow | null> {
  const sql = `SELECT * FROM bose_models WHERE model_number = $1 LIMIT 1`;
  const result = orgId
    ? await tenantQuery<BoseModelRow>(orgId, sql, [modelNumber.trim()])
    : await pool.query<BoseModelRow>(sql, [modelNumber.trim()]);
  return result.rows[0] ?? null;
}

// ─── Create (upsert reactivates a soft-deleted row) ─────────────────────────

export async function upsertBoseModel(params: {
  modelNumber: string;
  modelName: string;
  family?: string | null;
  productType?: string | null;
  releaseYear?: number | null;
  eolDate?: string | null;
  imageUrl?: string | null;
  notes?: string | null;
  isActive?: boolean;
}, orgId?: OrgId): Promise<BoseModelRow> {
  const sql =
    `INSERT INTO bose_models
       (model_number, model_name, family, product_type, release_year, eol_date, image_url, notes, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (model_number) DO UPDATE SET
       model_name   = EXCLUDED.model_name,
       family       = COALESCE(EXCLUDED.family, bose_models.family),
       product_type = COALESCE(EXCLUDED.product_type, bose_models.product_type),
       release_year = COALESCE(EXCLUDED.release_year, bose_models.release_year),
       eol_date     = COALESCE(EXCLUDED.eol_date, bose_models.eol_date),
       image_url    = COALESCE(EXCLUDED.image_url, bose_models.image_url),
       notes        = COALESCE(EXCLUDED.notes, bose_models.notes),
       is_active    = EXCLUDED.is_active,
       updated_at   = NOW()
     RETURNING *`;
  const values = [
    params.modelNumber.trim(),
    params.modelName.trim(),
    params.family?.trim() || null,
    params.productType?.trim() || null,
    params.releaseYear ?? null,
    params.eolDate || null,
    params.imageUrl?.trim() || null,
    params.notes?.trim() || null,
    params.isActive ?? true,
  ];
  // bose_models has no organization_id to stamp (reference-decide); when orgId
  // is present we still GUC-wrap the write so RLS can backstop once a column lands.
  const result = orgId
    ? await withTenantTransaction(orgId, (client) =>
        client.query<BoseModelRow>(sql, values),
      )
    : await pool.query<BoseModelRow>(sql, values);
  return result.rows[0];
}

// ─── Partial update (dynamic SET; identity column model_number is fixed) ────

export async function updateBoseModel(
  id: number,
  updates: {
    modelName?: string;
    family?: string | null;
    productType?: string | null;
    releaseYear?: number | null;
    eolDate?: string | null;
    imageUrl?: string | null;
    notes?: string | null;
    isActive?: boolean;
  },
  orgId?: OrgId,
): Promise<BoseModelRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (updates.modelName !== undefined) push('model_name', updates.modelName.trim());
  if (updates.family !== undefined) push('family', updates.family?.trim() || null);
  if (updates.productType !== undefined) push('product_type', updates.productType?.trim() || null);
  if (updates.releaseYear !== undefined) push('release_year', updates.releaseYear ?? null);
  if (updates.eolDate !== undefined) push('eol_date', updates.eolDate || null);
  if (updates.imageUrl !== undefined) push('image_url', updates.imageUrl?.trim() || null);
  if (updates.notes !== undefined) push('notes', updates.notes?.trim() || null);
  if (updates.isActive !== undefined) push('is_active', updates.isActive);

  if (sets.length === 0) return getBoseModelById(id, orgId);
  sets.push(`updated_at = NOW()`);
  values.push(id);

  const sql = `UPDATE bose_models SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
  // bose_models has no organization_id to gate on (reference-decide); the id is a
  // surrogate PK. GUC-wrap the write when orgId is present so RLS can backstop.
  const result = orgId
    ? await withTenantTransaction(orgId, (client) =>
        client.query<BoseModelRow>(sql, values),
      )
    : await pool.query<BoseModelRow>(sql, values);
  return result.rows[0] ?? null;
}

export async function softDeleteBoseModel(id: number, orgId?: OrgId): Promise<BoseModelRow | null> {
  const sql =
    `UPDATE bose_models
        SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND is_active = true
      RETURNING *`;
  const result = orgId
    ? await withTenantTransaction(orgId, (client) =>
        client.query<BoseModelRow>(sql, [id]),
      )
    : await pool.query<BoseModelRow>(sql, [id]);
  return result.rows[0] ?? null;
}

// ─── Compatible parts for a model (joined to stock / lifecycle / alerts) ────

/**
 * Returns the compatible parts for a model, each resolved against:
 *   - live on-hand (SUM of bin_contents.qty for the part's sku text key)
 *   - the part's sku_catalog.lifecycle_status
 *   - count of open/sourcing sourcing_alerts on that sku
 * so the lookup pane can flag "compatible but unavailable / EOL" at a glance.
 */
export async function getCompatibleParts(boseModelId: number, orgId?: OrgId): Promise<CompatiblePartRow[]> {
  // OMITTED path: byte-identical legacy SQL on the raw pool.
  if (!orgId) {
    const result = await pool.query<CompatiblePartRow>(
      `SELECT
       pc.id   AS compatibility_id,
       sc.id   AS sku_id,
       sc.sku,
       sc.product_title,
       sc.image_url,
       pc.part_role,
       pc.is_oem,
       pc.fit,
       pc.confidence,
       sc.lifecycle_status,
       COALESCE(stock.on_hand, 0)::int AS on_hand,
       COALESCE(al.open_alert_count, 0)::int AS open_alert_count
     FROM part_compatibility pc
     JOIN sku_catalog sc ON sc.id = pc.sku_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(bc.qty), 0)::int AS on_hand
       FROM bin_contents bc WHERE bc.sku = sc.sku
     ) stock ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS open_alert_count
       FROM sourcing_alerts sa
       WHERE sa.sku_id = sc.id AND sa.status IN ('open','sourcing')
     ) al ON TRUE
     WHERE pc.bose_model_id = $1
     ORDER BY pc.part_role, sc.product_title`,
      [boseModelId],
    );
    return result.rows;
  }

  // PRESENT path: GUC-wrap (part_compatibility has no org column) + explicit org
  // gating on the tenant-owned tables this fans out to:
  //   - sku_catalog sc is tenant-owned → AND sc.organization_id = $2
  //   - bin_contents bc is tenant-owned and joined on the SKU string key
  //     (bc.sku = sc.sku) → align with AND bc.organization_id = sc.organization_id
  //   - sourcing_alerts sa joins by integer surrogate PK (sa.sku_id = sc.id), so
  //     it's org-safe bare (it carries no own organization_id; child of sku_catalog)
  const result = await tenantQuery<CompatiblePartRow>(
    orgId,
    `SELECT
       pc.id   AS compatibility_id,
       sc.id   AS sku_id,
       sc.sku,
       sc.product_title,
       sc.image_url,
       pc.part_role,
       pc.is_oem,
       pc.fit,
       pc.confidence,
       sc.lifecycle_status,
       COALESCE(stock.on_hand, 0)::int AS on_hand,
       COALESCE(al.open_alert_count, 0)::int AS open_alert_count
     FROM part_compatibility pc
     JOIN sku_catalog sc ON sc.id = pc.sku_id AND sc.organization_id = $2
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(bc.qty), 0)::int AS on_hand
       FROM bin_contents bc WHERE bc.sku = sc.sku AND bc.organization_id = sc.organization_id
     ) stock ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS open_alert_count
       FROM sourcing_alerts sa
       WHERE sa.sku_id = sc.id AND sa.status IN ('open','sourcing')
     ) al ON TRUE
     WHERE pc.bose_model_id = $1
     ORDER BY pc.part_role, sc.product_title`,
    [boseModelId, orgId],
  );
  return result.rows;
}

export interface BoseModelDetailResult {
  model: BoseModelRow;
  parts: CompatiblePartRow[];
}

export async function getBoseModelDetail(id: number, orgId?: OrgId): Promise<BoseModelDetailResult | null> {
  const model = await getBoseModelById(id, orgId);
  if (!model) return null;
  const parts = await getCompatibleParts(id, orgId);
  return { model, parts };
}

// ─── Lookup by serial or model (the compatibility search entry point) ───────

export interface CompatibilityLookupResult {
  resolvedBy: 'model_number' | 'serial_prefix' | 'model_name' | null;
  model: BoseModelRow | null;
  parts: CompatiblePartRow[];
}

/**
 * Resolve a model from either a serial number (longest-prefix decode via
 * bose_serial_prefixes) or a model string (exact model_number, else name
 * search), then return its compatible parts. Degrades gracefully: an unknown
 * serial prefix or model returns { model: null, parts: [] }.
 */
export async function lookupCompatibility(params: {
  serial?: string | null;
  model?: string | null;
}, orgId?: OrgId): Promise<CompatibilityLookupResult> {
  const serial = (params.serial || '').trim();
  const model = (params.model || '').trim();

  // 1. Serial → longest matching prefix → model
  if (serial) {
    // bose_serial_prefixes has no organization_id (reference-decide); GUC-wrap only.
    const prefixSql =
      `SELECT bose_model_id
         FROM bose_serial_prefixes
        WHERE $1 ILIKE prefix || '%'
        ORDER BY length(prefix) DESC
        LIMIT 1`;
    const decoded = orgId
      ? await tenantQuery<{ bose_model_id: number }>(orgId, prefixSql, [serial])
      : await pool.query<{ bose_model_id: number }>(prefixSql, [serial]);
    const modelId = decoded.rows[0]?.bose_model_id;
    if (modelId) {
      const m = await getBoseModelById(modelId, orgId);
      if (m && m.is_active) {
        return { resolvedBy: 'serial_prefix', model: m, parts: await getCompatibleParts(m.id, orgId) };
      }
    }
  }

  // 2. Model string → exact model_number
  if (model) {
    const exact = await getBoseModelByModelNumber(model, orgId);
    if (exact && exact.is_active) {
      return { resolvedBy: 'model_number', model: exact, parts: await getCompatibleParts(exact.id, orgId) };
    }
    // 3. Fall back to a name/number ILIKE search (best single match)
    // bose_models has no organization_id (reference-decide); GUC-wrap only.
    const fuzzySql =
      `SELECT * FROM bose_models
        WHERE is_active = true
          AND (model_number ILIKE '%' || $1 || '%' OR model_name ILIKE '%' || $1 || '%')
        ORDER BY (model_number = $1) DESC, model_name
        LIMIT 1`;
    const fuzzy = orgId
      ? await tenantQuery<BoseModelRow>(orgId, fuzzySql, [model])
      : await pool.query<BoseModelRow>(fuzzySql, [model]);
    const m = fuzzy.rows[0];
    if (m) {
      return { resolvedBy: 'model_name', model: m, parts: await getCompatibleParts(m.id, orgId) };
    }
  }

  return { resolvedBy: null, model: null, parts: [] };
}
