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
  const platform = params.platform.trim();
  const platformSku = params.platformSku?.trim() || null;
  const platformItemId = params.platformItemId?.trim() || null;
  const accountName = params.accountName?.trim() || null;

  // If a row with this (platform, sku/itemId) already exists (e.g. unpaired
  // Ecwid row from sync), claim it by setting sku_catalog_id.
  if (platformSku) {
    const existing = await pool.query(
      `SELECT * FROM sku_platform_ids
       WHERE platform = $1
         AND platform_sku = $2
         AND COALESCE(account_name, '') = COALESCE($3, '')
       LIMIT 1`,
      [platform, platformSku, accountName],
    );
    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE sku_platform_ids
         SET sku_catalog_id = $1,
             platform_item_id = COALESCE(platform_item_id, $2),
             is_active = true
         WHERE id = $3
         RETURNING *`,
        [params.skuCatalogId, platformItemId, existing.rows[0].id],
      );
      return updated.rows[0];
    }
  }

  if (platformItemId) {
    const existing = await pool.query(
      `SELECT * FROM sku_platform_ids
       WHERE platform = $1
         AND platform_item_id = $2
         AND COALESCE(account_name, '') = COALESCE($3, '')
       LIMIT 1`,
      [platform, platformItemId, accountName],
    );
    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE sku_platform_ids
         SET sku_catalog_id = $1,
             platform_sku = COALESCE(platform_sku, $2),
             is_active = true
         WHERE id = $3
         RETURNING *`,
        [params.skuCatalogId, platformSku, existing.rows[0].id],
      );
      return updated.rows[0];
    }
  }

  const result = await pool.query(
    `INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_sku, platform_item_id, account_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.skuCatalogId, platform, platformSku, platformItemId, accountName],
  );
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

// ─── Resolve-or-Create: upsert into sku_catalog + sku_platform_ids ──────────

/**
 * Detect platform from account_source / order_id patterns.
 */
function detectPlatform(
  accountSource?: string | null,
  orderId?: string | null,
): string {
  const src = (accountSource || '').trim().toLowerCase();
  if (src.startsWith('ebay')) return 'ebay';
  if (src === 'ecwid') return 'ecwid';
  if (src === 'fba' || src === 'amazon_fba') return 'amazon_fba';
  if (src === 'shipstation') return 'shipstation';
  if (src.startsWith('amazon') || src.startsWith('amz')) return 'amazon';
  if (src.startsWith('walmart')) return 'walmart';

  // Fallback: guess from order_id format
  const oid = (orderId || '').trim();
  if (/^\d{2}-\d+-\d+$/.test(oid)) return 'ebay';
  if (/^\d{3}-\d+-\d+$/.test(oid)) return 'amazon';
  if (/^\d{15}$/.test(oid)) return 'walmart';
  if (/^\d{4}$/.test(oid)) return 'ecwid';

  return src || 'unknown';
}

/**
 * Resolve sku_catalog_id from available identifiers,
 * creating a new sku_catalog row (and optional sku_platform_ids row)
 * if nothing exists yet.
 *
 * Returns the sku_catalog_id or null if no sku/itemNumber provided.
 */
export async function resolveOrCreateSkuCatalogId(params: {
  sku?: string | null;
  itemNumber?: string | null;
  productTitle?: string | null;
  accountSource?: string | null;
  orderId?: string | null;
}): Promise<number | null> {
  const sku = (params.sku || '').trim() || null;
  const itemNumber = (params.itemNumber || '').trim() || null;
  const productTitle = (params.productTitle || '').trim() || 'Unknown Product';

  // 1. Try resolving from existing data
  const existingId = await resolveSkuCatalogId(sku, itemNumber);
  if (existingId) {
    // If we have an item number that isn't linked yet, link it
    if (itemNumber) {
      const platform = detectPlatform(params.accountSource, params.orderId);
      await upsertSkuPlatformId({
        skuCatalogId: existingId,
        platform,
        platformItemId: itemNumber,
        accountName: params.accountSource?.trim() || null,
      }).catch(() => {}); // ignore conflicts
    }
    return existingId;
  }

  // 2. Nothing found — create new catalog entry if we have a SKU
  if (sku) {
    const catalogRow = await upsertSkuCatalog({
      sku,
      productTitle,
    });

    // Also link the item number as a platform ID
    if (itemNumber) {
      const platform = detectPlatform(params.accountSource, params.orderId);
      await upsertSkuPlatformId({
        skuCatalogId: catalogRow.id,
        platform,
        platformItemId: itemNumber,
        accountName: params.accountSource?.trim() || null,
      }).catch(() => {});
    }

    return catalogRow.id;
  }

  // 3. No SKU but have item number — can't create a catalog entry without a SKU
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

// ─── Cache-first resolve-or-fetch from Zoho ─────────────────────────────────

/**
 * Cache-first lookup for sku_catalog. Falls back to Zoho Inventory on miss:
 *   1. SELECT sku_catalog WHERE sku = $1 — synchronous cache path.
 *   2. If hint.zoho_item_id: GET /items/{id}, upsert, return.
 *   3. Else fall back to GET /items?sku={sku}, upsert first match, return.
 *
 * Never throws. Returns null on any Zoho failure or no-match so the caller
 * can proceed with sku_catalog_id = null (relaxed mode). Intended for use
 * inside waitUntil() blocks — synchronous hot-path callers should use
 * getSkuCatalogBySku() directly.
 *
 * Rate-limit guard: callers within one request should de-dupe by SKU
 * (e.g. a Map<string, Promise<...>>) before invoking this, since Zoho's
 * monthly budget is constrained.
 */
export async function ensureSkuCatalogEntry(
  sku: string,
  hint?: { zoho_item_id?: string; zoho_purchaseorder_id?: string },
): Promise<SkuCatalogRow | null> {
  const trimmed = (sku || '').trim();

  // 1. Cache
  if (trimmed) {
    const cached = await getSkuCatalogBySku(trimmed);
    if (cached) return cached;
  }

  // 2. Zoho fallback — dynamic import keeps Zoho out of non-receiving code paths
  try {
    const { zohoClient } = await import('@/lib/zoho/ZohoInventoryClient');

    if (hint?.zoho_item_id) {
      const item = await zohoClient.getItem(hint.zoho_item_id);
      if (item?.sku) {
        return await upsertSkuCatalog({
          sku: item.sku,
          productTitle: item.name || 'Unknown Product',
          upc: item.upc ?? null,
          ean: item.ean ?? null,
          isActive: item.status !== 'inactive',
        });
      }
    }

    if (trimmed) {
      const listRes = await zohoClient.listItems({ sku: trimmed });
      const match =
        listRes.items?.find((i) => i.sku === trimmed) || listRes.items?.[0];
      if (match?.sku) {
        return await upsertSkuCatalog({
          sku: match.sku,
          productTitle: match.name || 'Unknown Product',
          upc: match.upc ?? null,
          ean: match.ean ?? null,
          isActive: match.status !== 'inactive',
        });
      }
    }
  } catch (err) {
    console.warn(
      `ensureSkuCatalogEntry: Zoho lookup failed for sku="${trimmed}":`,
      err,
    );
  }

  return null;
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
       product_title = COALESCE(NULLIF(sku_catalog.product_title, 'Unknown Product'), EXCLUDED.product_title),
       upc = COALESCE(EXCLUDED.upc, sku_catalog.upc),
       ean = COALESCE(EXCLUDED.ean, sku_catalog.ean),
       image_url = COALESCE(EXCLUDED.image_url, sku_catalog.image_url),
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
    params,
  );
}

// ─── Unpaired Ecwid Products ────────────────────────────────────────────────

export interface UnpairedEcwidProduct {
  id: number;
  platform_sku: string | null;
  platform_item_id: string | null;
  display_name: string | null;
  image_url: string | null;
  order_count: number;
}

export async function getUnpairedEcwidProducts(params: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: UnpairedEcwidProduct[]; total: number }> {
  const search = (params.q || '').trim();
  const limit = Math.min(params.limit || 100, 500);
  const offset = params.offset || 0;

  const result = await pool.query(
    `SELECT
       sp.id,
       sp.platform_sku,
       sp.platform_item_id,
       sp.display_name,
       sp.image_url,
       COUNT(DISTINCT o.id)::int AS order_count
     FROM sku_platform_ids sp
     LEFT JOIN orders o ON o.sku = sp.platform_sku AND o.sku IS NOT NULL
     WHERE sp.platform = 'ecwid'
       AND sp.sku_catalog_id IS NULL
       AND sp.is_active = true
       AND ($1 = '' OR sp.display_name ILIKE '%' || $1 || '%' OR sp.platform_sku ILIKE '%' || $1 || '%')
     GROUP BY sp.id
     ORDER BY order_count DESC, sp.display_name
     LIMIT $2 OFFSET $3`,
    [search, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM sku_platform_ids sp
     WHERE sp.platform = 'ecwid'
       AND sp.sku_catalog_id IS NULL
       AND sp.is_active = true
       AND ($1 = '' OR sp.display_name ILIKE '%' || $1 || '%' OR sp.platform_sku ILIKE '%' || $1 || '%')`,
    [search],
  );

  return {
    items: result.rows,
    total: countResult.rows[0]?.total || 0,
  };
}

/**
 * Pair an Ecwid product to a Zoho SKU.
 * Sets sku_catalog_id on the sku_platform_ids row and backfills image.
 */
export async function pairEcwidToZoho(
  ecwidPlatformRowId: number,
  skuCatalogId: number,
): Promise<{ paired: boolean; imageBackfilled: boolean }> {
  // Set the sku_catalog_id on the Ecwid platform entry
  const updateResult = await pool.query(
    `UPDATE sku_platform_ids
     SET sku_catalog_id = $1
     WHERE id = $2 AND platform = 'ecwid'
     RETURNING image_url`,
    [skuCatalogId, ecwidPlatformRowId],
  );

  if (!updateResult.rows[0]) return { paired: false, imageBackfilled: false };

  // Backfill image_url on sku_catalog from Ecwid thumbnail
  const ecwidImageUrl = updateResult.rows[0].image_url;
  let imageBackfilled = false;
  if (ecwidImageUrl) {
    const imgResult = await pool.query(
      `UPDATE sku_catalog
       SET image_url = $1, updated_at = NOW()
       WHERE id = $2 AND image_url IS NULL`,
      [ecwidImageUrl, skuCatalogId],
    );
    imageBackfilled = (imgResult.rowCount || 0) > 0;
  }

  return { paired: true, imageBackfilled };
}

// ─── Paginated SKU Catalog List (with counts) ──────────────────────────────

export interface SkuCatalogListRow {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  platform_count: number;
  manual_count: number;
  qc_step_count: number;
  order_count: number;
  ecwid_display_name: string | null;
  ecwid_image_url: string | null;
  ecwid_sku: string | null;
}

export async function getSkuCatalogList(params: {
  q?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  dir?: string;
  ecwidOnly?: boolean;
}): Promise<{ items: SkuCatalogListRow[]; total: number }> {
  const search = (params.q || '').trim();
  const limit = Math.min(params.limit || 100, 500);
  const offset = params.offset || 0;
  const desc = params.dir === 'desc';

  let orderBy: string;
  switch (params.sort) {
    case 'ordered':
      orderBy = desc
        ? 'order_count ASC NULLS LAST, sc.sku'
        : 'order_count DESC NULLS LAST, sc.sku';
      break;
    case 'shipped':
      orderBy = desc
        ? 'last_shipped ASC NULLS LAST, sc.sku'
        : 'last_shipped DESC NULLS LAST, sc.sku';
      break;
    default:
      orderBy = desc
        ? 'sc.product_title DESC, sc.sku DESC'
        : 'sc.product_title, sc.sku';
      break;
  }

  const result = await pool.query(
    `SELECT
       sc.id, sc.sku, sc.product_title, sc.category, sc.image_url, sc.is_active,
       COUNT(DISTINCT sp.id)::int AS platform_count,
       COUNT(DISTINCT pm.id)::int AS manual_count,
       COUNT(DISTINCT qc.id)::int AS qc_step_count,
       COALESCE(oc.order_count, 0)::int AS order_count,
       ls.last_shipped,
       ecwid.display_name AS ecwid_display_name,
       ecwid.image_url AS ecwid_image_url,
       ecwid.platform_sku AS ecwid_sku
     FROM sku_catalog sc
     LEFT JOIN sku_platform_ids sp ON sp.sku_catalog_id = sc.id AND sp.is_active = true
     LEFT JOIN product_manuals pm ON pm.sku_catalog_id = sc.id AND pm.is_active = true
     LEFT JOIN qc_check_templates qc ON qc.sku_catalog_id = sc.id
     LEFT JOIN (
       SELECT sku_catalog_id, COUNT(*)::int AS order_count
       FROM orders
       WHERE sku_catalog_id IS NOT NULL
       GROUP BY sku_catalog_id
     ) oc ON oc.sku_catalog_id = sc.id
     LEFT JOIN (
       SELECT o.sku_catalog_id, MAX(o.created_at) AS last_shipped
       FROM orders o
       JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       WHERE o.sku_catalog_id IS NOT NULL
         AND (stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered)
       GROUP BY o.sku_catalog_id
     ) ls ON ls.sku_catalog_id = sc.id
     LEFT JOIN LATERAL (
       SELECT e.display_name, e.image_url, e.platform_sku
       FROM sku_platform_ids e
       WHERE e.sku_catalog_id = sc.id AND e.platform = 'ecwid' AND e.is_active = true AND e.display_name IS NOT NULL
       LIMIT 1
     ) ecwid ON TRUE
     WHERE sc.is_active = true
       AND ($1 = '' OR sc.sku ILIKE '%' || $1 || '%' OR sc.product_title ILIKE '%' || $1 || '%' OR sc.category ILIKE '%' || $1 || '%')
       ${params.ecwidOnly ? `AND EXISTS (SELECT 1 FROM sku_platform_ids e WHERE e.sku_catalog_id = sc.id AND e.platform = 'ecwid' AND e.is_active = true AND e.display_name IS NOT NULL)` : ''}
     GROUP BY sc.id, oc.order_count, ls.last_shipped, ecwid.display_name, ecwid.image_url, ecwid.platform_sku
     ORDER BY ${orderBy}
     LIMIT $2 OFFSET $3`,
    [search, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM sku_catalog sc
     WHERE sc.is_active = true
       AND ($1 = '' OR sc.sku ILIKE '%' || $1 || '%' OR sc.product_title ILIKE '%' || $1 || '%' OR sc.category ILIKE '%' || $1 || '%')
       ${params.ecwidOnly ? `AND EXISTS (SELECT 1 FROM sku_platform_ids e WHERE e.sku_catalog_id = sc.id AND e.platform = 'ecwid' AND e.is_active = true AND e.display_name IS NOT NULL)` : ''}`,
    [search],
  );

  return {
    items: result.rows,
    total: countResult.rows[0]?.total || 0,
  };
}

// ─── SKU Catalog Detail (full) ─────────────────────────────────────────────

export interface SkuCatalogDetailResult {
  catalog: SkuCatalogRow;
  platformIds: SkuPlatformIdRow[];
  manuals: Array<{
    id: number;
    sku: string | null;
    item_number: string | null;
    product_title: string | null;
    display_name: string | null;
    google_file_id: string;
    type: string | null;
    is_active: boolean;
    updated_at: string | null;
  }>;
  qcChecks: QcCheckTemplateRow[];
}

export async function getSkuCatalogDetail(id: number): Promise<SkuCatalogDetailResult | null> {
  const catalog = await getSkuCatalogById(id);
  if (!catalog) return null;

  const [platformResult, manualResult, qcResult] = await Promise.all([
    pool.query(
      `SELECT * FROM sku_platform_ids WHERE sku_catalog_id = $1 AND is_active = true ORDER BY platform, created_at`,
      [id],
    ),
    pool.query(
      `SELECT id, sku, item_number, product_title, display_name, google_file_id, type, is_active, updated_at
       FROM product_manuals WHERE sku_catalog_id = $1 AND is_active = true ORDER BY updated_at DESC`,
      [id],
    ),
    pool.query(
      `SELECT * FROM qc_check_templates WHERE sku_catalog_id = $1 ORDER BY sort_order, id`,
      [id],
    ),
  ]);

  return {
    catalog,
    platformIds: platformResult.rows,
    manuals: manualResult.rows,
    qcChecks: qcResult.rows,
  };
}

// ─── Manual CRUD (per catalog) ─────────────────────────────────────────────

export async function createManualForCatalog(params: {
  skuCatalogId: number;
  googleFileId: string;
  displayName?: string | null;
  type?: string | null;
}): Promise<any> {
  const catalog = await getSkuCatalogById(params.skuCatalogId);
  if (!catalog) throw new Error('SKU catalog entry not found');

  const result = await pool.query(
    `INSERT INTO product_manuals (sku_catalog_id, sku, google_file_id, display_name, type, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING *`,
    [
      params.skuCatalogId,
      catalog.sku,
      params.googleFileId.trim(),
      params.displayName?.trim() || null,
      params.type?.trim() || null,
    ],
  );
  return result.rows[0];
}

export async function updateManual(
  id: number,
  updates: { displayName?: string | null; type?: string | null; googleFileId?: string | null },
): Promise<any> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.displayName !== undefined) {
    sets.push(`display_name = $${idx++}`);
    values.push(updates.displayName?.trim() || null);
  }
  if (updates.type !== undefined) {
    sets.push(`type = $${idx++}`);
    values.push(updates.type?.trim() || null);
  }
  if (updates.googleFileId !== undefined) {
    sets.push(`google_file_id = $${idx++}`);
    values.push(updates.googleFileId?.trim() || '');
  }

  if (sets.length === 0) return null;
  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE product_manuals SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function deleteManual(id: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE product_manuals SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  return (result.rowCount || 0) > 0;
}

// ─── QC Check Template CRUD (per catalog) ──────────────────────────────────

export async function createQcCheck(params: {
  skuCatalogId: number;
  stepLabel: string;
  stepType?: string;
  sortOrder?: number;
}): Promise<QcCheckTemplateRow> {
  const result = await pool.query(
    `INSERT INTO qc_check_templates (sku_catalog_id, step_label, step_type, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      params.skuCatalogId,
      params.stepLabel.trim(),
      params.stepType?.trim() || 'PASS_FAIL',
      params.sortOrder ?? 0,
    ],
  );
  return result.rows[0];
}

export async function updateQcCheck(
  id: number,
  updates: { stepLabel?: string; stepType?: string; sortOrder?: number },
): Promise<QcCheckTemplateRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.stepLabel !== undefined) {
    sets.push(`step_label = $${idx++}`);
    values.push(updates.stepLabel.trim());
  }
  if (updates.stepType !== undefined) {
    sets.push(`step_type = $${idx++}`);
    values.push(updates.stepType.trim());
  }
  if (updates.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx++}`);
    values.push(updates.sortOrder);
  }

  if (sets.length === 0) return null;
  values.push(id);

  const result = await pool.query(
    `UPDATE qc_check_templates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function deleteQcCheck(id: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM qc_check_templates WHERE id = $1`,
    [id],
  );
  return (result.rowCount || 0) > 0;
}

// ─── Platform ID CRUD (delete) ─────────────────────────────────────────────

export async function updateSkuPlatformId(
  id: number,
  updates: { platform?: string; platformSku?: string | null; platformItemId?: string | null; accountName?: string | null },
): Promise<SkuPlatformIdRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.platform !== undefined) {
    sets.push(`platform = $${idx++}`);
    values.push(updates.platform.trim());
  }
  if (updates.platformSku !== undefined) {
    sets.push(`platform_sku = $${idx++}`);
    values.push(updates.platformSku?.trim() || null);
  }
  if (updates.platformItemId !== undefined) {
    sets.push(`platform_item_id = $${idx++}`);
    values.push(updates.platformItemId?.trim() || null);
  }
  if (updates.accountName !== undefined) {
    sets.push(`account_name = $${idx++}`);
    values.push(updates.accountName?.trim() || null);
  }

  if (sets.length === 0) return null;
  values.push(id);

  const result = await pool.query(
    `UPDATE sku_platform_ids SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function deleteSkuPlatformId(id: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE sku_platform_ids SET is_active = false WHERE id = $1`,
    [id],
  );
  return (result.rowCount || 0) > 0;
}
