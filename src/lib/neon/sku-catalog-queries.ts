import pool from '../db';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SkuCatalogRow {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  upc: string | null;
  ean: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkuPlatformIdRow {
  id: number;
  sku_catalog_id: number;
  platform: string;
  platform_sku: string | null;
  platform_item_id: string | null;
  account_name: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SkuKitPartRow {
  id: number;
  sku_catalog_id: number;
  component_name: string;
  component_type: string;
  qty_required: number;
  required_for: string[] | null;
  is_critical: boolean;
  sort_order: number;
}

export interface QcCheckTemplateRow {
  id: number;
  sku_catalog_id: number | null;
  category: string | null;
  step_label: string;
  step_type: string;
  sort_order: number;
}

export interface TechVerificationRow {
  id: number;
  source_kind: string;
  source_row_id: number;
  sku_catalog_id: number;
  step_type: string;
  step_id: number;
  passed: boolean | null;
  verified_by: number | null;
  verified_at: string;
  notes: string | null;
}

// ─── Normalize (same as product-manuals.ts) ──────────────────────────────────

function normalizeId(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^0+/, '');
}

// ─── SKU Catalog CRUD ────────────────────────────────────────────────────────

export async function getSkuCatalogBySku(sku: string): Promise<SkuCatalogRow | null> {
  const result = await pool.query(
    `SELECT * FROM sku_catalog WHERE sku = $1 LIMIT 1`,
    [sku.trim()],
  );
  return result.rows[0] ?? null;
}

export async function getSkuCatalogById(id: number): Promise<SkuCatalogRow | null> {
  const result = await pool.query(
    `SELECT * FROM sku_catalog WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function upsertSkuCatalog(params: {
  sku: string;
  productTitle: string;
  category?: string | null;
  upc?: string | null;
  ean?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
}): Promise<SkuCatalogRow> {
  const result = await pool.query(
    `INSERT INTO sku_catalog (sku, product_title, category, upc, ean, image_url, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sku) DO UPDATE SET
       product_title = EXCLUDED.product_title,
       category = COALESCE(EXCLUDED.category, sku_catalog.category),
       upc = COALESCE(EXCLUDED.upc, sku_catalog.upc),
       ean = COALESCE(EXCLUDED.ean, sku_catalog.ean),
       image_url = COALESCE(EXCLUDED.image_url, sku_catalog.image_url),
       is_active = EXCLUDED.is_active,
       updated_at = NOW()
     RETURNING *`,
    [
      params.sku.trim(),
      params.productTitle.trim(),
      params.category?.trim() || null,
      params.upc?.trim() || null,
      params.ean?.trim() || null,
      params.imageUrl?.trim() || null,
      params.isActive ?? true,
    ],
  );
  return result.rows[0];
}

// ─── Platform ID CRUD ────────────────────────────────────────────────────────

export async function getSkuPlatformIds(skuCatalogId: number): Promise<SkuPlatformIdRow[]> {
  const result = await pool.query(
    `SELECT * FROM sku_platform_ids
     WHERE sku_catalog_id = $1 AND is_active = true
     ORDER BY platform, created_at`,
    [skuCatalogId],
  );
  return result.rows;
}

export async function upsertSkuPlatformId(params: {
  skuCatalogId: number;
  platform: string;
  platformSku?: string | null;
  platformItemId?: string | null;
  accountName?: string | null;
}): Promise<SkuPlatformIdRow> {
  const result = await pool.query(
    `INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_sku, platform_item_id, account_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      params.skuCatalogId,
      params.platform.trim(),
      params.platformSku?.trim() || null,
      params.platformItemId?.trim() || null,
      params.accountName?.trim() || null,
    ],
  );
  // If conflict (already exists), fetch existing
  if (result.rows.length === 0) {
    const existing = await pool.query(
      `SELECT * FROM sku_platform_ids
       WHERE sku_catalog_id = $1 AND platform = $2
         AND COALESCE(platform_sku, '') = COALESCE($3, '')
         AND COALESCE(account_name, '') = COALESCE($5, '')
       LIMIT 1`,
      [
        params.skuCatalogId,
        params.platform.trim(),
        params.platformSku?.trim() || null,
        params.platformItemId?.trim() || null,
        params.accountName?.trim() || null,
      ],
    );
    return existing.rows[0];
  }
  return result.rows[0];
}

// ─── Central Resolver: any platform identifier → sku_catalog_id ─────────────

export async function resolveSkuCatalogByPlatformId(
  identifier: string,
): Promise<number | null> {
  const normalized = normalizeId(identifier);
  if (!normalized) return null;

  const result = await pool.query(
    `SELECT sku_catalog_id FROM sku_platform_ids
     WHERE regexp_replace(UPPER(TRIM(COALESCE(platform_item_id, ''))), '[^A-Z0-9]', '', 'g') = $1
        OR regexp_replace(UPPER(TRIM(COALESCE(platform_sku, ''))), '[^A-Z0-9]', '', 'g') = $1
     LIMIT 1`,
    [normalized],
  );
  return result.rows[0]?.sku_catalog_id ?? null;
}

/** Resolve by direct SKU text match on sku_catalog.sku */
export async function resolveSkuCatalogBySku(
  sku: string,
): Promise<number | null> {
  const trimmed = (sku || '').trim();
  if (!trimmed) return null;

  const result = await pool.query(
    `SELECT id FROM sku_catalog WHERE sku = $1 LIMIT 1`,
    [trimmed],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Resolve sku_catalog_id from any available identifier.
 * Tries: direct SKU match → platform_item_id / platform_sku crosswalk.
 */
export async function resolveSkuCatalogId(
  sku?: string | null,
  itemNumber?: string | null,
): Promise<number | null> {
  // 1. Try direct SKU match
  if (sku) {
    const id = await resolveSkuCatalogBySku(sku);
    if (id) return id;
  }
  // 2. Try platform crosswalk via item number
  if (itemNumber) {
    const id = await resolveSkuCatalogByPlatformId(itemNumber);
    if (id) return id;
  }
  return null;
}

// ─── Kit Parts (BOM) ────────────────────────────────────────────────────────

export async function getKitParts(
  skuCatalogId: number,
  condition?: string | null,
): Promise<SkuKitPartRow[]> {
  const result = await pool.query(
    `SELECT * FROM sku_kit_parts
     WHERE sku_catalog_id = $1
       AND ($2::text IS NULL OR required_for IS NULL OR $2 = ANY(required_for))
     ORDER BY sort_order, id`,
    [skuCatalogId, condition?.trim() || null],
  );
  return result.rows;
}

// ─── QC Check Templates ─────────────────────────────────────────────────────

export async function getQcChecks(
  skuCatalogId: number,
  category?: string | null,
): Promise<QcCheckTemplateRow[]> {
  const result = await pool.query(
    `SELECT * FROM qc_check_templates
     WHERE sku_catalog_id = $1
        OR ($2::text IS NOT NULL AND category = $2 AND sku_catalog_id IS NULL)
     ORDER BY sort_order, id`,
    [skuCatalogId, category?.trim() || null],
  );
  return result.rows;
}

// ─── Tech Verifications ─────────────────────────────────────────────────────

export async function getVerifications(
  sourceKind: string,
  sourceRowId: number,
): Promise<TechVerificationRow[]> {
  const result = await pool.query(
    `SELECT * FROM tech_verifications
     WHERE source_kind = $1 AND source_row_id = $2
     ORDER BY verified_at`,
    [sourceKind, sourceRowId],
  );
  return result.rows;
}

export async function upsertVerification(params: {
  sourceKind: string;
  sourceRowId: number;
  skuCatalogId: number;
  stepType: string;
  stepId: number;
  passed: boolean;
  verifiedBy: number;
  notes?: string | null;
}): Promise<TechVerificationRow> {
  // Upsert: one verification per (source_kind, source_row_id, step_type, step_id)
  const result = await pool.query(
    `INSERT INTO tech_verifications
       (source_kind, source_row_id, sku_catalog_id, step_type, step_id, passed, verified_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      params.sourceKind,
      params.sourceRowId,
      params.skuCatalogId,
      params.stepType,
      params.stepId,
      params.passed,
      params.verifiedBy,
      params.notes?.trim() || null,
    ],
  );
  if (result.rows.length > 0) return result.rows[0];

  // Already exists — update it
  const updated = await pool.query(
    `UPDATE tech_verifications
     SET passed = $6, verified_by = $7, verified_at = NOW(), notes = $8
     WHERE source_kind = $1 AND source_row_id = $2
       AND step_type = $4 AND step_id = $5
     RETURNING *`,
    [
      params.sourceKind,
      params.sourceRowId,
      params.skuCatalogId,
      params.stepType,
      params.stepId,
      params.passed,
      params.verifiedBy,
      params.notes?.trim() || null,
    ],
  );
  return updated.rows[0];
}

// ─── Zoho Sync Helper ───────────────────────────────────────────────────────

/**
 * Sync items from Zoho upsert into sku_catalog.
 * Called after itemRepository.upsertMany().
 */
export async function syncSkuCatalogFromItems(
  rows: Array<{ sku?: string | null; name?: string | null; upc?: string | null; ean?: string | null; image_url?: string | null; status?: string | null }>,
): Promise<void> {
  const valid = rows.filter((r) => r.sku && r.sku.trim());
  if (valid.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  for (const row of valid) {
    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
    params.push(
      row.sku!.trim(),
      (row.name || 'Unknown Product').trim(),
      row.upc?.trim() || null,
      row.ean?.trim() || null,
      row.image_url?.trim() || null,
      row.status === 'active',
    );
    idx += 6;
  }

  await pool.query(
    `INSERT INTO sku_catalog (sku, product_title, upc, ean, image_url, is_active)
     VALUES ${values.join(', ')}
     ON CONFLICT (sku) DO UPDATE SET
       product_title = EXCLUDED.product_title,
       upc = COALESCE(EXCLUDED.upc, sku_catalog.upc),
       ean = COALESCE(EXCLUDED.ean, sku_catalog.ean),
       image_url = COALESCE(EXCLUDED.image_url, sku_catalog.image_url),
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
    params,
  );
}
