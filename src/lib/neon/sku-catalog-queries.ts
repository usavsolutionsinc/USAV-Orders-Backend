import pool from '../db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { upsertSkuPackProfileLink } from '@/lib/neon/pack-profile-links';
import { classifyPackTier } from '@/lib/packing/pack-tier-classifier';

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
  // ─ Sourcing lifecycle (Bose engine; migration 2026-06-06d) ─
  lifecycle_status: string;
  reorder_threshold: number | null;
  last_known_cost_cents: number | null;
  sourcing_notes: string | null;
  replenish_target_cents: number | null;
  /** Per-SKU pack/handling guidance shown to the packer (P1-PCK-02). */
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkuPlatformIdRow {
  id: number;
  sku_catalog_id: number | null;
  platform: string;
  platform_sku: string | null;
  platform_item_id: string | null;
  account_name: string | null;
  is_active: boolean;
  created_at: string;
  // 2026-05-25 pairing hub additions
  listing_title: string | null;
  listing_url: string | null;
  listing_status: string | null;
  confidence: number | null;
  paired_by: number | null;
  paired_at: string | null;
  do_not_suggest_until: string | null;
  // Ecwid-era columns retained for sync compatibility
  display_name?: string | null;
  image_url?: string | null;
}

// ─── Pairing hub interfaces (2026-05-25) ────────────────────────────────────

export type PairingAuditAction =
  | 'accept'
  | 'reject'
  | 'unpair'
  | 'create_platform_row';

export type PairingAuditActorKind = 'user' | 'system';

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
  // Lifecycle + structured-value foundation (2026-06-06). Older callers that
  // don't select these still type-check (optional); the columns always exist.
  status?: string;
  value_kind?: string | null;
  value_unit?: string | null;
  value_enum?: string[] | null;
  pass_min?: string | null;
  pass_max?: string | null;
  failure_mode_id?: number | null;
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
  value_num?: string | null;
  value_text?: string | null;
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

export async function getSkuCatalogBySku(sku: string, orgId?: OrgId): Promise<SkuCatalogRow | null> {
  const sql = `SELECT * FROM sku_catalog WHERE sku = $1${orgId ? ' AND organization_id = $2' : ''} LIMIT 1`;
  const result = orgId
    ? await tenantQuery<SkuCatalogRow>(orgId, sql, [sku.trim(), orgId])
    : await pool.query<SkuCatalogRow>(sql, [sku.trim()]);
  return result.rows[0] ?? null;
}

export async function getSkuCatalogById(id: number, orgId?: OrgId): Promise<SkuCatalogRow | null> {
  const sql = `SELECT * FROM sku_catalog WHERE id = $1${orgId ? ' AND organization_id = $2' : ''} LIMIT 1`;
  const result = orgId
    ? await tenantQuery<SkuCatalogRow>(orgId, sql, [id, orgId])
    : await pool.query<SkuCatalogRow>(sql, [id]);
  return result.rows[0] ?? null;
}

/**
 * Lookup by GTIN (GS1 Digital Link AI 01). Returns the row whose `gtin`
 * column matches a digit-stripped form of the input — the column itself
 * is stored as a digit string, but callers may pass URL-encoded or
 * dash-formatted variants from a scanner.
 */
export async function getSkuCatalogByGtin(gtin: string, orgId?: OrgId): Promise<SkuCatalogRow | null> {
  const cleaned = String(gtin || '').replace(/\D/g, '');
  if (!cleaned) return null;
  const sql = `SELECT * FROM sku_catalog WHERE gtin = $1${orgId ? ' AND organization_id = $2' : ''} LIMIT 1`;
  const result = orgId
    ? await tenantQuery<SkuCatalogRow>(orgId, sql, [cleaned, orgId])
    : await pool.query<SkuCatalogRow>(sql, [cleaned]);
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
  // ─ Sourcing lifecycle (all optional; omitted = preserve existing / default) ─
  lifecycleStatus?: string | null;
  reorderThreshold?: number | null;
  lastKnownCostCents?: number | null;
  sourcingNotes?: string | null;
  /** Per-SKU replenish target price (cents). Below this, the watcher alerts. */
  replenishTargetCents?: number | null;
  /** Per-SKU pack/handling guidance shown to the packer (P1-PCK-02). */
  notes?: string | null;
}, orgId: OrgId): Promise<SkuCatalogRow> {
  // The lifecycle params are referenced directly ($8–$11) rather than via
  // EXCLUDED so that omitting them (null) preserves the existing row on update
  // and falls back to the column default ('active') on insert — callers that
  // don't opt into lifecycle behave exactly as before.
  //
  // orgId is REQUIRED: we explicitly stamp organization_id ($14) on insert and
  // scope the upsert via tenantQuery, and conflict on (organization_id, sku) so
  // the same SKU string can exist per-org (H4). Callers thread ctx.organizationId
  // / the sync account's org — there is no global (org-less) upsert path.
  const values: unknown[] = [
    params.sku.trim(),
    params.productTitle.trim(),
    params.category?.trim() || null,
    params.upc?.trim() || null,
    params.ean?.trim() || null,
    params.imageUrl?.trim() || null,
    params.isActive ?? true,
    params.lifecycleStatus ?? null,
    params.reorderThreshold ?? null,
    params.lastKnownCostCents ?? null,
    params.sourcingNotes?.trim() || null,
    params.replenishTargetCents ?? null,
    // notes ($13): pack guidance. `notes === undefined` (omitted) preserves the
    // existing row via COALESCE; an explicit null also preserves (we don't clear
    // on upsert here — clearing goes through the PATCH null path), so trim-or-null
    // is the right normalization.
    params.notes !== undefined ? (params.notes?.trim() || null) : null,
    orgId,
  ];
  const sql = `INSERT INTO sku_catalog
       (sku, product_title, category, upc, ean, image_url, is_active,
        lifecycle_status, reorder_threshold, last_known_cost_cents, sourcing_notes,
        replenish_target_cents, notes, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'active'), $9, $10, $11, $12, $13, $14)
     ON CONFLICT (organization_id, sku) DO UPDATE SET
       product_title = EXCLUDED.product_title,
       category = COALESCE(EXCLUDED.category, sku_catalog.category),
       upc = COALESCE(EXCLUDED.upc, sku_catalog.upc),
       ean = COALESCE(EXCLUDED.ean, sku_catalog.ean),
       image_url = COALESCE(EXCLUDED.image_url, sku_catalog.image_url),
       is_active = EXCLUDED.is_active,
       lifecycle_status = COALESCE($8, sku_catalog.lifecycle_status),
       reorder_threshold = COALESCE($9, sku_catalog.reorder_threshold),
       last_known_cost_cents = COALESCE($10, sku_catalog.last_known_cost_cents),
       sourcing_notes = COALESCE($11, sku_catalog.sourcing_notes),
       replenish_target_cents = COALESCE($12, sku_catalog.replenish_target_cents),
       notes = COALESCE($13, sku_catalog.notes),
       updated_at = NOW()
     RETURNING *`;
  // Always tenant-scoped: orgId is required, the row is stamped organization_id
  // ($14), and the upsert conflicts on (organization_id, sku) — so two orgs can
  // hold the same SKU string without colliding (the H4 per-org-unique fix).
  const result = await tenantQuery<SkuCatalogRow>(orgId, sql, values);
  return result.rows[0];
}

/**
 * Soft-delete a SKU catalog entry by flipping `is_active = false`. We never
 * hard-delete: platform ids, manuals, QC checks, stock ledger rows and audit
 * history all reference the catalog row by id, so removing it would orphan
 * them. Returns the (now-inactive) row, or null if it doesn't exist or was
 * already inactive — callers should pre-fetch for the audit before-state.
 */
export async function softDeleteSkuCatalog(id: number, orgId?: OrgId): Promise<SkuCatalogRow | null> {
  const sql = `UPDATE sku_catalog
        SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND is_active = true${orgId ? ' AND organization_id = $2' : ''}
      RETURNING *`;
  const result = orgId
    ? await tenantQuery<SkuCatalogRow>(orgId, sql, [id, orgId])
    : await pool.query<SkuCatalogRow>(sql, [id]);
  return result.rows[0] ?? null;
}

// ─── Platform ID CRUD ────────────────────────────────────────────────────────

export async function getSkuPlatformIds(skuCatalogId: number, orgId?: OrgId): Promise<SkuPlatformIdRow[]> {
  const sql = `SELECT * FROM sku_platform_ids
     WHERE sku_catalog_id = $1 AND is_active = true${orgId ? ' AND organization_id = $2' : ''}
     ORDER BY platform, created_at`;
  const result = orgId
    ? await tenantQuery<SkuPlatformIdRow>(orgId, sql, [skuCatalogId, orgId])
    : await pool.query<SkuPlatformIdRow>(sql, [skuCatalogId]);
  return result.rows;
}

export async function upsertSkuPlatformId(params: {
  skuCatalogId: number;
  platform: string;
  platformSku?: string | null;
  platformItemId?: string | null;
  accountName?: string | null;
}, orgId?: OrgId): Promise<SkuPlatformIdRow> {
  const platform = params.platform.trim();
  const platformSku = params.platformSku?.trim() || null;
  const platformItemId = params.platformItemId?.trim() || null;
  const accountName = params.accountName?.trim() || null;

  // When orgId is provided, every SELECT/UPDATE/INSERT runs through tenantQuery
  // with an explicit organization_id filter (and stamp on insert); when omitted
  // every statement keeps the exact prior session-less pool.query behavior.
  const q = <T extends SkuPlatformIdRow = SkuPlatformIdRow>(
    sql: string,
    values: unknown[],
  ) =>
    orgId
      ? tenantQuery<T>(orgId, sql, values)
      : pool.query<T>(sql, values);

  // If a row with this (platform, sku/itemId) already exists (e.g. unpaired
  // Ecwid row from sync), claim it by setting sku_catalog_id.
  if (platformSku) {
    const existing = await q(
      `SELECT * FROM sku_platform_ids
       WHERE platform = $1
         AND platform_sku = $2
         AND COALESCE(account_name, '') = COALESCE($3, '')${orgId ? '\n         AND organization_id = $4' : ''}
       LIMIT 1`,
      orgId ? [platform, platformSku, accountName, orgId] : [platform, platformSku, accountName],
    );
    if (existing.rows.length > 0) {
      const updated = await q(
        `UPDATE sku_platform_ids
         SET sku_catalog_id = $1,
             platform_item_id = COALESCE(platform_item_id, $2),
             is_active = true
         WHERE id = $3${orgId ? '\n           AND organization_id = $4' : ''}
         RETURNING *`,
        orgId
          ? [params.skuCatalogId, platformItemId, existing.rows[0].id, orgId]
          : [params.skuCatalogId, platformItemId, existing.rows[0].id],
      );
      return updated.rows[0];
    }
  }

  if (platformItemId) {
    const existing = await q(
      `SELECT * FROM sku_platform_ids
       WHERE platform = $1
         AND platform_item_id = $2
         AND COALESCE(account_name, '') = COALESCE($3, '')${orgId ? '\n         AND organization_id = $4' : ''}
       LIMIT 1`,
      orgId ? [platform, platformItemId, accountName, orgId] : [platform, platformItemId, accountName],
    );
    if (existing.rows.length > 0) {
      const updated = await q(
        `UPDATE sku_platform_ids
         SET sku_catalog_id = $1,
             platform_sku = COALESCE(platform_sku, $2),
             is_active = true
         WHERE id = $3${orgId ? '\n           AND organization_id = $4' : ''}
         RETURNING *`,
        orgId
          ? [params.skuCatalogId, platformSku, existing.rows[0].id, orgId]
          : [params.skuCatalogId, platformSku, existing.rows[0].id],
      );
      return updated.rows[0];
    }
  }

  const result = await q(
    `INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_sku, platform_item_id, account_name${orgId ? ', organization_id' : ''})
     VALUES ($1, $2, $3, $4, $5${orgId ? ', $6' : ''})
     RETURNING *`,
    orgId
      ? [params.skuCatalogId, platform, platformSku, platformItemId, accountName, orgId]
      : [params.skuCatalogId, platform, platformSku, platformItemId, accountName],
  );
  return result.rows[0];
}

// ─── Central Resolver: any platform identifier → sku_catalog_id ─────────────

export async function resolveSkuCatalogByPlatformId(
  identifier: string,
  orgId?: OrgId,
): Promise<number | null> {
  const normalized = normalizeId(identifier);
  if (!normalized) return null;

  // When orgId is provided we scope the lookup to that tenant's platform rows
  // (sku_platform_ids is tenant-owned); when omitted we keep the exact prior
  // session-less pool.query behavior.
  const sql = `SELECT sku_catalog_id FROM sku_platform_ids
     WHERE (regexp_replace(UPPER(TRIM(COALESCE(platform_item_id, ''))), '[^A-Z0-9]', '', 'g') = $1
        OR regexp_replace(UPPER(TRIM(COALESCE(platform_sku, ''))), '[^A-Z0-9]', '', 'g') = $1)${orgId ? '\n       AND organization_id = $2' : ''}
     LIMIT 1`;
  const result = orgId
    ? await tenantQuery(orgId, sql, [normalized, orgId])
    : await pool.query(sql, [normalized]);
  return result.rows[0]?.sku_catalog_id ?? null;
}

export interface SkuCatalogTitleMatch {
  id: number;
  sku: string;
  productTitle: string;
}

/**
 * Minimum trigram similarity for a title-only catalog match when the import
 * row has no SKU or platform item number to anchor on (Google Sheet minimal
 * imports). Higher than {@link SKU_TITLE_GUARD_MIN} because there is no SKU
 * cross-check — we need a stronger title signal to avoid false positives.
 */
export const SKU_TITLE_ONLY_MIN = 0.45;

/**
 * Batch-resolve sku_catalog rows from product titles alone.
 *
 * Used by the Google Sheets transfer job for small-business imports that only
 * carry an order number + product title. Returns a map keyed by the exact
 * input title string (trimmed) so callers can look up per row.
 */
export async function batchResolveSkuCatalogByTitles(
  titles: string[],
  orgId?: OrgId,
): Promise<Map<string, SkuCatalogTitleMatch>> {
  const unique = Array.from(new Set(titles.map((t) => t.trim()).filter(Boolean)));
  const out = new Map<string, SkuCatalogTitleMatch>();
  if (unique.length === 0) return out;

  const sql = `WITH inputs AS (
       SELECT title, LOWER(TRIM(title)) AS norm
         FROM unnest($1::text[]) AS title
     )
     SELECT DISTINCT ON (inputs.title)
       inputs.title AS input_title,
       sc.id,
       sc.sku,
       sc.product_title,
       CASE
         WHEN LOWER(TRIM(sc.product_title)) = inputs.norm THEN 1.0
         ELSE similarity(LOWER(sc.product_title), inputs.norm)
       END AS sim
     FROM inputs
     JOIN sku_catalog sc ON (
       LOWER(TRIM(sc.product_title)) = inputs.norm
       OR similarity(LOWER(sc.product_title), inputs.norm) >= ${SKU_TITLE_ONLY_MIN}
     )
     WHERE sc.product_title IS NOT NULL
       AND BTRIM(sc.product_title) <> ''
       ${orgId ? 'AND sc.organization_id = $2' : ''}
     ORDER BY inputs.title,
       (LOWER(TRIM(sc.product_title)) = inputs.norm) DESC,
       sim DESC,
       sc.id`;

  const result = orgId
    ? await tenantQuery(orgId, sql, [unique, orgId])
    : await pool.query(sql, [unique]);

  for (const row of result.rows) {
    const inputTitle = String(row.input_title || '').trim();
    const id = Number(row.id);
    const sku = String(row.sku || '').trim();
    const productTitle = String(row.product_title || '').trim();
    if (!inputTitle || !Number.isFinite(id) || id <= 0 || !sku) continue;
    out.set(inputTitle, { id, sku, productTitle });
  }
  return out;
}

/**
 * Best-effort platform_item_id per sku_catalog row (for backfilling orders.item_number
 * when a sheet import matched by title but carries no listing id).
 */
export async function batchPlatformItemIdsByCatalogIds(
  catalogIds: number[],
  orgId?: OrgId,
): Promise<Map<number, string>> {
  const unique = Array.from(new Set(catalogIds.filter((id) => Number.isFinite(id) && id > 0)));
  const out = new Map<number, string>();
  if (unique.length === 0) return out;

  const sql = `SELECT DISTINCT ON (sku_catalog_id)
       sku_catalog_id,
       platform_item_id
     FROM sku_platform_ids
     WHERE sku_catalog_id = ANY($1::int[])
       AND platform_item_id IS NOT NULL
       AND BTRIM(platform_item_id) <> ''
       AND is_active = true
       ${orgId ? 'AND organization_id = $2' : ''}
     ORDER BY sku_catalog_id, id DESC`;

  const result = orgId
    ? await tenantQuery(orgId, sql, [unique, orgId])
    : await pool.query(sql, [unique]);

  for (const row of result.rows) {
    const catalogId = Number(row.sku_catalog_id);
    const itemId = String(row.platform_item_id || '').trim();
    if (Number.isFinite(catalogId) && catalogId > 0 && itemId) {
      out.set(catalogId, itemId);
    }
  }
  return out;
}

/**
 * Minimum trigram similarity between a sku_catalog row's product_title and a
 * caller-supplied expected title for a same-SKU match to be trusted.
 *
 * `sku_catalog` holds the MARKETPLACE SKU namespace (ecwid/ebay/amazon). Zoho
 * `items` is a SEPARATE namespace that collides on the same zero-padded strings
 * — e.g. Ecwid SKU 143 = "Bose UB-20 Wall Mount" vs Zoho SKU 00143 = "Bose Solo
 * Soundbar". A bare `sku = $1` match therefore binds a Zoho line to the wrong
 * product. When the caller knows the Zoho product name it passes it as
 * `expectedTitle`; we only trust the same-SKU row if its title actually
 * resembles that product. Measured separation on live data: real collisions
 * score ~0.10, legitimate same-product matches score ≥0.25.
 */
export const SKU_TITLE_GUARD_MIN = 0.25;

/**
 * Resolve by direct SKU text match on sku_catalog.sku.
 *
 * When `expectedTitle` is provided, the matched row is returned only if its
 * product_title is similar enough to be the same product (cross-namespace
 * collision guard — see {@link SKU_TITLE_GUARD_MIN}). On a collision we return
 * `null` rather than the wrong product: the caller falls back to the Zoho title
 * and the line carries no (wrong) catalog identity until it's paired for real.
 */
export async function resolveSkuCatalogBySku(
  sku: string,
  expectedTitle?: string | null,
  orgId?: OrgId,
): Promise<number | null> {
  const trimmed = (sku || '').trim();
  if (!trimmed) return null;

  // When orgId is provided every SELECT is scoped to that tenant's catalog
  // (sku_catalog is tenant-owned) via tenantQuery + an explicit
  // organization_id predicate; when omitted behavior is byte-identical to before.
  const want = (expectedTitle || '').trim();
  if (!want) {
    const sql = `SELECT id FROM sku_catalog WHERE sku = $1${orgId ? ' AND organization_id = $2' : ''} LIMIT 1`;
    const result = orgId
      ? await tenantQuery(orgId, sql, [trimmed, orgId])
      : await pool.query(sql, [trimmed]);
    return result.rows[0]?.id ?? null;
  }

  // Same-SKU match must also be the same PRODUCT (guard cross-namespace SKU
  // collisions between the marketplace catalog and Zoho's numbering).
  const sql = `SELECT id, similarity(LOWER(product_title), LOWER($2)) AS sim
       FROM sku_catalog WHERE sku = $1${orgId ? ' AND organization_id = $3' : ''} LIMIT 1`;
  const result = orgId
    ? await tenantQuery(orgId, sql, [trimmed, want, orgId])
    : await pool.query(sql, [trimmed, want]);
  const row = result.rows[0];
  if (row && Number(row.sim) >= SKU_TITLE_GUARD_MIN) return row.id;
  return null;
}

/**
 * Resolve sku_catalog_id from any available identifier.
 * Tries: direct SKU match → platform_item_id / platform_sku crosswalk.
 *
 * Pass `expectedTitle` (the Zoho item name) when resolving for a Zoho-sourced
 * line so a colliding marketplace SKU isn't mistaken for the same product.
 */
export async function resolveSkuCatalogId(
  sku?: string | null,
  itemNumber?: string | null,
  expectedTitle?: string | null,
  orgId?: OrgId,
): Promise<number | null> {
  // 1. Try direct SKU match (title-guarded when an expected title is known)
  if (sku) {
    const id = await resolveSkuCatalogBySku(sku, expectedTitle, orgId);
    if (id) return id;
  }
  // 2. Try platform crosswalk via item number
  if (itemNumber) {
    const id = await resolveSkuCatalogByPlatformId(itemNumber, orgId);
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
  /**
   * When set, treat `productTitle` as the authoritative product identity and
   * refuse to either bind to OR overwrite a same-SKU `sku_catalog` row that is a
   * DIFFERENT product. Used by the Zoho receiving-line path, whose SKU namespace
   * collides with the marketplace catalog (see {@link SKU_TITLE_GUARD_MIN}).
   * Marketplace sync callers leave this unset and keep the prior behavior.
   */
  guardTitle?: string | null;
}, orgId: OrgId): Promise<number | null> {
  const sku = (params.sku || '').trim() || null;
  const itemNumber = (params.itemNumber || '').trim() || null;
  const productTitle = (params.productTitle || '').trim() || 'Unknown Product';
  const guardTitle = (params.guardTitle || '').trim() || null;

  // When orgId is provided, every resolve/upsert/read below is threaded with it
  // so the whole resolve-or-create runs inside the caller's tenant; when omitted
  // each call keeps its existing (raw-pool / GUC-default) behavior unchanged.

  // 1. Try resolving from existing data (title-guarded for Zoho-namespace lines)
  const existingId = await resolveSkuCatalogId(sku, itemNumber, guardTitle, orgId);
  if (existingId) {
    // If we have an item number that isn't linked yet, link it
    if (itemNumber) {
      const platform = detectPlatform(params.accountSource, params.orderId);
      await upsertSkuPlatformId({
        skuCatalogId: existingId,
        platform,
        platformItemId: itemNumber,
        accountName: params.accountSource?.trim() || null,
      }, orgId).catch(() => {}); // ignore conflicts
    }
    return existingId;
  }

  // 2. Nothing found — create new catalog entry if we have a SKU
  if (sku) {
    // Guarded callers must never clobber a colliding marketplace row. If the
    // SKU is already taken by a different product, upsert-by-sku would
    // overwrite its title — bail out instead of corrupting it. (The Zoho line
    // gets its correct catalog identity via the authoritative Ecwid/Zoho
    // cross-check path, not by squatting on a marketplace SKU.)
    if (guardTitle) {
      const clashSql = `SELECT id FROM sku_catalog WHERE sku = $1 AND organization_id = $2 LIMIT 1`;
      const clash = await tenantQuery(orgId, clashSql, [sku, orgId]);
      if (clash.rows[0]) return null;
    }
    const catalogRow = await upsertSkuCatalog({
      sku,
      productTitle,
    }, orgId);

    // Also link the item number as a platform ID
    if (itemNumber) {
      const platform = detectPlatform(params.accountSource, params.orderId);
      await upsertSkuPlatformId({
        skuCatalogId: catalogRow.id,
        platform,
        platformItemId: itemNumber,
        accountName: params.accountSource?.trim() || null,
      }, orgId).catch(() => {});
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
  orgId?: OrgId,
): Promise<SkuKitPartRow[]> {
  // sku_kit_parts is tenant-owned (organization_id added 2026-05-23). When orgId
  // is provided we scope explicitly; when omitted behavior is byte-identical.
  const sql = `SELECT * FROM sku_kit_parts
     WHERE sku_catalog_id = $1
       AND ($2::text IS NULL OR required_for IS NULL OR $2 = ANY(required_for))${orgId ? '\n       AND organization_id = $3' : ''}
     ORDER BY sort_order, id`;
  const result = orgId
    ? await tenantQuery<SkuKitPartRow>(orgId, sql, [skuCatalogId, condition?.trim() || null, orgId])
    : await pool.query<SkuKitPartRow>(sql, [skuCatalogId, condition?.trim() || null]);
  return result.rows;
}

/**
 * Create one kit part (BOM row) under a SKU. Mirrors createQcCheck: when orgId
 * is provided the INSERT stamps organization_id and runs inside one
 * withTenantTransaction (GUC set), and attaching a part reactivates a retired
 * SKU so it resurfaces in the catalog. When omitted, behavior is byte-identical.
 */
export async function createKitPart(
  params: {
    skuCatalogId: number;
    componentName: string;
    componentType?: string;
    qtyRequired?: number;
    requiredFor?: string[] | null;
    isCritical?: boolean;
    sortOrder?: number;
  },
  orgId?: OrgId,
): Promise<SkuKitPartRow> {
  const requiredForArr =
    params.requiredFor != null && params.requiredFor.length > 0 ? params.requiredFor : null;

  const insertValues: unknown[] = [
    params.skuCatalogId,
    params.componentName.trim(),
    params.componentType?.trim() || 'PART',
    params.qtyRequired ?? 1,
    requiredForArr,
    params.isCritical ?? true,
    params.sortOrder ?? 0,
  ];
  if (orgId) insertValues.push(orgId);
  const insertSql = `INSERT INTO sku_kit_parts
       (sku_catalog_id, component_name, component_type, qty_required, required_for, is_critical, sort_order${orgId ? ', organization_id' : ''})
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7${orgId ? ', $8' : ''})
     RETURNING *`;

  const reactivateSql = `UPDATE sku_catalog SET is_active = true, updated_at = NOW()
     WHERE id = $1 AND is_active = false${orgId ? ' AND organization_id = $2' : ''}`;

  if (orgId) {
    return await withTenantTransaction(orgId, async (client) => {
      const result = await client.query<SkuKitPartRow>(insertSql, insertValues);
      await client.query(reactivateSql, [params.skuCatalogId, orgId]);
      return result.rows[0];
    });
  }

  const result = await pool.query<SkuKitPartRow>(insertSql, insertValues);
  await pool.query(reactivateSql, [params.skuCatalogId]);
  return result.rows[0];
}

export async function updateKitPart(
  id: number,
  updates: {
    componentName?: string;
    componentType?: string;
    qtyRequired?: number;
    requiredFor?: string[] | null;
    isCritical?: boolean;
    sortOrder?: number;
  },
  orgId?: OrgId,
): Promise<SkuKitPartRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.componentName !== undefined) {
    sets.push(`component_name = $${idx++}`);
    values.push(updates.componentName.trim());
  }
  if (updates.componentType !== undefined) {
    sets.push(`component_type = $${idx++}`);
    values.push(updates.componentType?.trim() || 'PART');
  }
  if (updates.qtyRequired !== undefined) {
    sets.push(`qty_required = $${idx++}`);
    values.push(updates.qtyRequired);
  }
  if (updates.requiredFor !== undefined) {
    sets.push(`required_for = $${idx++}::text[]`);
    values.push(updates.requiredFor != null && updates.requiredFor.length > 0 ? updates.requiredFor : null);
  }
  if (updates.isCritical !== undefined) {
    sets.push(`is_critical = $${idx++}`);
    values.push(updates.isCritical);
  }
  if (updates.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx++}`);
    values.push(updates.sortOrder);
  }

  if (sets.length === 0) return null;
  const idPlaceholder = idx++;
  values.push(id);

  // sku_kit_parts is tenant-owned. When orgId is provided we add an explicit
  // organization_id predicate (a foreign-org id updates 0 rows → the 404 path)
  // and run via withTenantTransaction. When omitted, behavior is byte-identical.
  let where = `id = $${idPlaceholder}`;
  if (orgId) {
    where += ` AND organization_id = $${idx++}`;
    values.push(orgId);
  }

  const sql = `UPDATE sku_kit_parts SET ${sets.join(', ')} WHERE ${where} RETURNING *`;
  const result = orgId
    ? await withTenantTransaction(orgId, (client) => client.query<SkuKitPartRow>(sql, values))
    : await pool.query<SkuKitPartRow>(sql, values);
  return result.rows[0] ?? null;
}

export async function deleteKitPart(id: number, orgId?: OrgId): Promise<boolean> {
  // sku_kit_parts is tenant-owned. When orgId is provided we add an explicit
  // organization_id predicate and run via withTenantTransaction; when omitted,
  // behavior is byte-identical to before.
  const sql = `DELETE FROM sku_kit_parts WHERE id = $1${orgId ? ' AND organization_id = $2' : ''}`;
  const result = orgId
    ? await withTenantTransaction(orgId, (client) => client.query(sql, [id, orgId]))
    : await pool.query(sql, [id]);
  return (result.rowCount || 0) > 0;
}

// ─── QC Check Templates ─────────────────────────────────────────────────────

export async function getQcChecks(
  skuCatalogId: number,
  category?: string | null,
  opts?: { publishedOnly?: boolean },
  orgId?: OrgId,
): Promise<QcCheckTemplateRow[]> {
  // Execution views (testing-bundle, tech checklist) pass publishedOnly so draft
  // steps under authoring stay hidden. Authoring views omit it to see all.
  const publishedOnly = opts?.publishedOnly === true;
  // qc_check_templates is tenant-owned. When orgId is provided we scope to it
  // (covers both the per-SKU and the category-default rows, which are themselves
  // org-owned); when omitted behavior is byte-identical to before.
  const sql = `SELECT * FROM qc_check_templates
     WHERE (sku_catalog_id = $1
        OR ($2::text IS NOT NULL AND category = $2 AND sku_catalog_id IS NULL))
       AND ($3::boolean IS FALSE OR status = 'published')${orgId ? '\n       AND organization_id = $4' : ''}
     ORDER BY sort_order, id`;
  const result = orgId
    ? await tenantQuery<QcCheckTemplateRow>(orgId, sql, [skuCatalogId, category?.trim() || null, publishedOnly, orgId])
    : await pool.query<QcCheckTemplateRow>(sql, [skuCatalogId, category?.trim() || null, publishedOnly]);
  return result.rows;
}

// ─── Tech Verifications ─────────────────────────────────────────────────────

export async function getVerifications(
  sourceKind: string,
  sourceRowId: number,
  orgId?: OrgId,
): Promise<TechVerificationRow[]> {
  // tech_verifications is tenant-owned. When orgId is provided we scope
  // explicitly; when omitted behavior is byte-identical to before.
  const sql = `SELECT * FROM tech_verifications
     WHERE source_kind = $1 AND source_row_id = $2${orgId ? '\n       AND organization_id = $3' : ''}
     ORDER BY verified_at`;
  const result = orgId
    ? await tenantQuery<TechVerificationRow>(orgId, sql, [sourceKind, sourceRowId, orgId])
    : await pool.query<TechVerificationRow>(sql, [sourceKind, sourceRowId]);
  return result.rows;
}

export async function upsertVerification(params: {
  sourceKind: string;
  sourceRowId: number;
  skuCatalogId: number;
  stepType: string;
  stepId: number;
  passed: boolean | null;
  verifiedBy: number;
  notes?: string | null;
  valueNum?: number | null;
  valueText?: string | null;
  failedModeId?: number | null;
}, orgId?: OrgId): Promise<TechVerificationRow> {
  // One verification per (source_kind, source_row_id, step_type, step_id) —
  // enforced by ux_tech_verifications_step (2026-05-29), so a re-mark UPDATEs
  // the single row in place.
  //
  // tech_verifications is tenant-owned. When orgId is provided we stamp
  // organization_id ($12) on insert and run via withTenantTransaction (GUC set),
  // so the row is attributed to the caller's tenant and RLS-subject; when omitted
  // the statement is byte-identical to before (raw pool, GUC-default org stamp).
  const values: unknown[] = [
    params.sourceKind,
    params.sourceRowId,
    params.skuCatalogId,
    params.stepType,
    params.stepId,
    params.passed,
    params.verifiedBy,
    params.notes?.trim() || null,
    params.valueNum ?? null,
    params.valueText?.trim() || null,
    params.failedModeId ?? null,
  ];
  if (orgId) values.push(orgId);
  const sql = `INSERT INTO tech_verifications
       (source_kind, source_row_id, sku_catalog_id, step_type, step_id,
        passed, verified_by, notes, value_num, value_text, failed_mode_id${orgId ? ', organization_id' : ''})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11${orgId ? ', $12' : ''})
     ON CONFLICT (source_kind, source_row_id, step_type, step_id) DO UPDATE
       SET passed     = EXCLUDED.passed,
           verified_by = EXCLUDED.verified_by,
           verified_at = NOW(),
           notes      = EXCLUDED.notes,
           value_num  = EXCLUDED.value_num,
           value_text = EXCLUDED.value_text,
           failed_mode_id = EXCLUDED.failed_mode_id
     RETURNING *`;
  const result = orgId
    ? await withTenantTransaction(orgId, (client) =>
        client.query<TechVerificationRow>(sql, values),
      )
    : await pool.query<TechVerificationRow>(sql, values);
  return result.rows[0];
}

/**
 * Derive a step's pass/fail. When the step has a numeric pass band
 * (pass_min/pass_max), the recorded number decides it (inclusive bounds);
 * otherwise fall back to the explicit boolean the tester sent. Returns null
 * when nothing can be determined (no band + no explicit value).
 */
export function deriveStepPassed(
  step: { pass_min?: string | number | null; pass_max?: string | number | null },
  recorded: { passed?: boolean; valueNum?: number | null },
): boolean | null {
  const min = step.pass_min == null ? null : Number(step.pass_min);
  const max = step.pass_max == null ? null : Number(step.pass_max);
  const hasBand = (min != null && !Number.isNaN(min)) || (max != null && !Number.isNaN(max));

  if (hasBand && recorded.valueNum != null) {
    if (min != null && !Number.isNaN(min) && recorded.valueNum < min) return false;
    if (max != null && !Number.isNaN(max) && recorded.valueNum > max) return false;
    return true;
  }
  if (recorded.passed !== undefined) return recorded.passed;
  return null;
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
  hint: { zoho_item_id?: string; zoho_purchaseorder_id?: string } | undefined,
  orgId: OrgId,
): Promise<SkuCatalogRow | null> {
  const trimmed = (sku || '').trim();

  // orgId (when provided) is threaded into the cache read and the upsert so the
  // ensured row lands in / is read from the caller's tenant; when omitted both
  // calls keep their prior behavior.

  // 1. Cache
  if (trimmed) {
    const cached = await getSkuCatalogBySku(trimmed, orgId);
    if (cached) return cached;
  }

  // 2. Zoho fallback — dynamic import keeps Zoho out of non-receiving code paths
  try {
    const { zohoClient } = await import('@/lib/zoho/ZohoInventoryClient');

    if (hint?.zoho_item_id) {
      const item = await zohoClient.getItem(hint.zoho_item_id);
      if (item?.sku) {
        const catalog = await upsertSkuCatalog({
          sku: item.sku,
          productTitle: item.name || 'Unknown Product',
          upc: item.upc ?? null,
          ean: item.ean ?? null,
          isActive: item.status !== 'inactive',
        }, orgId);
        // Best-effort: seed a default/rules-based pack profile if none exists yet.
        try {
          const c = classifyPackTier({ productTitle: catalog.product_title, category: catalog.category, sku: catalog.sku });
          await upsertSkuPackProfileLink(
            { skuCatalogId: catalog.id, packTier: c.packTier, estimatedMinutes: c.estimatedMinutes, source: 'rules' },
            orgId,
          );
        } catch {}
        return catalog;
      }
    }

    if (trimmed) {
      const listRes = await zohoClient.listItems({ sku: trimmed });
      const match =
        listRes.items?.find((i) => i.sku === trimmed) || listRes.items?.[0];
      if (match?.sku) {
        const catalog = await upsertSkuCatalog({
          sku: match.sku,
          productTitle: match.name || 'Unknown Product',
          upc: match.upc ?? null,
          ean: match.ean ?? null,
          isActive: match.status !== 'inactive',
        }, orgId);
        try {
          const c = classifyPackTier({ productTitle: catalog.product_title, category: catalog.category, sku: catalog.sku });
          await upsertSkuPackProfileLink(
            { skuCatalogId: catalog.id, packTier: c.packTier, estimatedMinutes: c.estimatedMinutes, source: 'rules' },
            orgId,
          );
        } catch {}
        return catalog;
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
  orgId: OrgId,
): Promise<void> {
  const valid = rows.filter((r) => r.sku && r.sku.trim());
  if (valid.length === 0) return;

  // sku_catalog is tenant-owned. orgId is REQUIRED: every VALUES tuple carries an
  // organization_id column (stamp on insert), the upsert runs via
  // withTenantTransaction (GUC set), and conflicts on (organization_id, sku) so
  // the same SKU string can be synced per-org without colliding (H4).
  const cols = 7;
  const values: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  for (const row of valid) {
    const ph = [`$${idx}`, `$${idx + 1}`, `$${idx + 2}`, `$${idx + 3}`, `$${idx + 4}`, `$${idx + 5}`, `$${idx + 6}`];
    values.push(`(${ph.join(', ')})`);
    params.push(
      row.sku!.trim(),
      (row.name || 'Unknown Product').trim(),
      row.upc?.trim() || null,
      row.ean?.trim() || null,
      row.image_url?.trim() || null,
      row.status === 'active',
      orgId,
    );
    idx += cols;
  }

  const sql = `INSERT INTO sku_catalog (sku, product_title, upc, ean, image_url, is_active, organization_id)
     VALUES ${values.join(', ')}
     ON CONFLICT (organization_id, sku) DO UPDATE SET
       product_title = COALESCE(NULLIF(sku_catalog.product_title, 'Unknown Product'), EXCLUDED.product_title),
       upc = COALESCE(EXCLUDED.upc, sku_catalog.upc),
       ean = COALESCE(EXCLUDED.ean, sku_catalog.ean),
       image_url = COALESCE(EXCLUDED.image_url, sku_catalog.image_url),
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`;
  await withTenantTransaction(orgId, (client) => client.query(sql, params));
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
}, orgId: OrgId): Promise<{ items: UnpairedEcwidProduct[]; total: number }> {
  const search = (params.q || '').trim();
  const limit = Math.min(params.limit || 100, 500);
  const offset = params.offset || 0;

  const result = await tenantQuery<UnpairedEcwidProduct>(
    orgId,
    `SELECT
       sp.id,
       sp.platform_sku,
       sp.platform_item_id,
       sp.display_name,
       sp.image_url,
       COUNT(DISTINCT o.id)::int AS order_count
     FROM sku_platform_ids sp
     LEFT JOIN orders o ON o.sku = sp.platform_sku AND o.sku IS NOT NULL
       AND o.organization_id = sp.organization_id
     WHERE sp.platform = 'ecwid'
       AND sp.sku_catalog_id IS NULL
       AND sp.is_active = true
       AND sp.organization_id = $4
       AND ($1 = '' OR sp.display_name ILIKE '%' || $1 || '%' OR sp.platform_sku ILIKE '%' || $1 || '%')
     GROUP BY sp.id
     ORDER BY order_count DESC, sp.display_name
     LIMIT $2 OFFSET $3`,
    [search, limit, offset, orgId],
  );

  const countResult = await tenantQuery<{ total: number }>(
    orgId,
    `SELECT COUNT(*)::int AS total
     FROM sku_platform_ids sp
     WHERE sp.platform = 'ecwid'
       AND sp.sku_catalog_id IS NULL
       AND sp.is_active = true
       AND sp.organization_id = $2
       AND ($1 = '' OR sp.display_name ILIKE '%' || $1 || '%' OR sp.platform_sku ILIKE '%' || $1 || '%')`,
    [search, orgId],
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
  orgId: OrgId,
): Promise<{ paired: boolean; imageBackfilled: boolean }> {
  // Set the sku_catalog_id on the Ecwid platform entry
  const updateResult = await tenantQuery<{ image_url: string | null }>(
    orgId,
    `UPDATE sku_platform_ids
     SET sku_catalog_id = $1
     WHERE id = $2 AND platform = 'ecwid' AND organization_id = $3
     RETURNING image_url`,
    [skuCatalogId, ecwidPlatformRowId, orgId],
  );

  if (!updateResult.rows[0]) return { paired: false, imageBackfilled: false };

  // Backfill image_url on sku_catalog from Ecwid thumbnail
  const ecwidImageUrl = updateResult.rows[0].image_url;
  let imageBackfilled = false;
  if (ecwidImageUrl) {
    const imgResult = await tenantQuery(
      orgId,
      `UPDATE sku_catalog
       SET image_url = $1, updated_at = NOW()
       WHERE id = $2 AND image_url IS NULL AND organization_id = $3`,
      [ecwidImageUrl, skuCatalogId, orgId],
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
  lifecycle_status: string;
  reorder_threshold: number | null;
  last_known_cost_cents: number | null;
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
}, orgId?: OrgId): Promise<{ items: SkuCatalogListRow[]; total: number }> {
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

  // $4 is reserved for orgId (when provided) across both the list and count
  // queries; when omitted, the SQL and params match the prior behavior exactly.
  const listSql = `SELECT
       sc.id, sc.sku, sc.product_title, sc.category, sc.image_url, sc.is_active,
       sc.lifecycle_status, sc.reorder_threshold, sc.last_known_cost_cents,
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
     WHERE sc.is_active = true${orgId ? ' AND sc.organization_id = $4' : ''}
       AND ($1 = '' OR sc.sku ILIKE '%' || $1 || '%' OR sc.product_title ILIKE '%' || $1 || '%' OR sc.category ILIKE '%' || $1 || '%')
       ${params.ecwidOnly ? `AND EXISTS (SELECT 1 FROM sku_platform_ids e WHERE e.sku_catalog_id = sc.id AND e.platform = 'ecwid' AND e.is_active = true AND e.display_name IS NOT NULL)` : ''}
     GROUP BY sc.id, oc.order_count, ls.last_shipped, ecwid.display_name, ecwid.image_url, ecwid.platform_sku
     ORDER BY ${orderBy}
     LIMIT $2 OFFSET $3`;
  const result = orgId
    ? await tenantQuery<SkuCatalogListRow & { last_shipped: string | null }>(orgId, listSql, [search, limit, offset, orgId])
    : await pool.query<SkuCatalogListRow & { last_shipped: string | null }>(listSql, [search, limit, offset]);

  const countSql = `SELECT COUNT(*)::int AS total
     FROM sku_catalog sc
     WHERE sc.is_active = true${orgId ? ' AND sc.organization_id = $2' : ''}
       AND ($1 = '' OR sc.sku ILIKE '%' || $1 || '%' OR sc.product_title ILIKE '%' || $1 || '%' OR sc.category ILIKE '%' || $1 || '%')
       ${params.ecwidOnly ? `AND EXISTS (SELECT 1 FROM sku_platform_ids e WHERE e.sku_catalog_id = sc.id AND e.platform = 'ecwid' AND e.is_active = true AND e.display_name IS NOT NULL)` : ''}`;
  const countResult = orgId
    ? await tenantQuery<{ total: number }>(orgId, countSql, [search, orgId])
    : await pool.query<{ total: number }>(countSql, [search]);

  return {
    items: result.rows,
    total: countResult.rows[0]?.total || 0,
  };
}

// ─── SKU Catalog Detail (full) ─────────────────────────────────────────────

export interface SkuCatalogDetailResult {
  catalog: SkuCatalogRow;
  packProfile: { packTier: 'SMALL' | 'MEDIUM' | 'LARGE'; estimatedMinutes: number | null } | null;
  platformIds: SkuPlatformIdRow[];
  manuals: Array<{
    id: number;
    sku: string | null;
    item_number: string | null;
    product_title: string | null;
    display_name: string | null;
    google_file_id: string | null;
    source_url: string | null;
    relative_path: string | null;
    type: string | null;
    is_active: boolean;
    updated_at: string | null;
  }>;
  qcChecks: QcCheckTemplateRow[];
}

export async function getSkuCatalogDetail(id: number, orgId?: OrgId): Promise<SkuCatalogDetailResult | null> {
  const catalog = await getSkuCatalogById(id, orgId);
  if (!catalog) return null;

  const packProfileSql = `
    SELECT p.pack_tier, p.estimated_minutes
      FROM pack_profile_links l
      JOIN pack_profiles p ON p.id = l.pack_profile_id
     WHERE l.owner_type = 'SKU_CATALOG'
       AND l.owner_id = $1
      ${orgId ? 'AND l.organization_id = $2' : ''}
     LIMIT 1
  `;

  // sku_platform_ids and qc_check_templates are tenant-owned — both get an org
  // filter + GUC wrapper when orgId is provided (qc_check_templates must be
  // GUC-safe so FORCE row-level security can be enabled on it). product_manuals
  // has NO organization_id column (child-scoped to sku_catalog, already
  // org-verified by getSkuCatalogById above), so it stays on the raw pool. When
  // orgId is omitted, behavior is identical to before.
  const platformSql = `SELECT * FROM sku_platform_ids WHERE sku_catalog_id = $1 AND is_active = true${orgId ? ' AND organization_id = $2' : ''} ORDER BY platform, created_at`;
  const qcSql = `SELECT * FROM qc_check_templates WHERE sku_catalog_id = $1${orgId ? ' AND organization_id = $2' : ''} ORDER BY sort_order, id`;
  const [packProfileResult, platformResult, manualResult, qcResult] = await Promise.all([
    orgId
      ? tenantQuery<{ pack_tier: 'SMALL' | 'MEDIUM' | 'LARGE'; estimated_minutes: number | null }>(
        orgId,
        packProfileSql,
        [id, orgId],
      )
      : pool.query<{ pack_tier: 'SMALL' | 'MEDIUM' | 'LARGE'; estimated_minutes: number | null }>(packProfileSql, [id]),
    orgId
      ? tenantQuery<SkuPlatformIdRow>(orgId, platformSql, [id, orgId])
      : pool.query<SkuPlatformIdRow>(platformSql, [id]),
    pool.query(
      `SELECT id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, type, is_active, updated_at
       FROM product_manuals WHERE sku_catalog_id = $1 AND is_active = true ORDER BY updated_at DESC`,
      [id],
    ),
    orgId
      ? tenantQuery<QcCheckTemplateRow>(orgId, qcSql, [id, orgId])
      : pool.query<QcCheckTemplateRow>(qcSql, [id]),
  ]);

  return {
    catalog,
    packProfile: packProfileResult.rows[0]
      ? { packTier: packProfileResult.rows[0].pack_tier, estimatedMinutes: packProfileResult.rows[0].estimated_minutes }
      : null,
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
}, orgId?: OrgId): Promise<any> {
  // product_manuals has NO organization_id column (child-scoped to sku_catalog).
  // When orgId is provided we (1) verify ownership of the parent catalog row
  // (getSkuCatalogById scopes by org → throws "not found" for a foreign id,
  // the 404 path) and (2) GUC-wrap the child INSERT via withTenantTransaction so
  // any RLS policy bound to the parent's org sees the GUC. When omitted, behavior
  // is byte-identical to before.
  const catalog = await getSkuCatalogById(params.skuCatalogId, orgId);
  if (!catalog) throw new Error('SKU catalog entry not found');

  const sql = `INSERT INTO product_manuals (sku_catalog_id, sku, google_file_id, display_name, type, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING *`;
  const values = [
    params.skuCatalogId,
    catalog.sku,
    params.googleFileId.trim(),
    params.displayName?.trim() || null,
    params.type?.trim() || null,
  ];
  const result = orgId
    ? await withTenantTransaction(orgId, (client) => client.query(sql, values))
    : await pool.query(sql, values);
  return result.rows[0];
}

export async function updateManual(
  id: number,
  updates: { displayName?: string | null; type?: string | null; googleFileId?: string | null },
  orgId?: OrgId,
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
  const idPlaceholder = idx++;
  values.push(id);

  // product_manuals has NO organization_id column — scope via its org-bearing
  // parent (sku_catalog). When orgId is provided we add an EXISTS guard on the
  // parent catalog row's organization_id (a foreign-org row updates 0 rows → the
  // 404 path) and GUC-wrap the write. When omitted, behavior is byte-identical.
  let where = `id = $${idPlaceholder}`;
  if (orgId) {
    where += ` AND EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.id = product_manuals.sku_catalog_id AND sc.organization_id = $${idx++})`;
    values.push(orgId);
  }

  const sql = `UPDATE product_manuals SET ${sets.join(', ')} WHERE ${where} RETURNING *`;
  const result = orgId
    ? await withTenantTransaction(orgId, (client) => client.query(sql, values))
    : await pool.query(sql, values);
  return result.rows[0] ?? null;
}

export async function deleteManual(id: number, orgId?: OrgId): Promise<boolean> {
  // product_manuals has NO organization_id column — scope via parent sku_catalog
  // (org-bearing) when orgId is provided; GUC-wrap the write. When omitted,
  // behavior is byte-identical to before.
  const sql = `UPDATE product_manuals SET is_active = false, updated_at = NOW()
     WHERE id = $1${orgId ? ' AND EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.id = product_manuals.sku_catalog_id AND sc.organization_id = $2)' : ''}`;
  const result = orgId
    ? await withTenantTransaction(orgId, (client) => client.query(sql, [id, orgId]))
    : await pool.query(sql, [id]);
  return (result.rowCount || 0) > 0;
}

// ─── QC Check Template CRUD (per catalog) ──────────────────────────────────

export interface QcCheckValueConfig {
  valueKind?: string | null;
  valueUnit?: string | null;
  valueEnum?: string[] | null;
  passMin?: number | null;
  passMax?: number | null;
  failureModeId?: number | null;
}

export async function createQcCheck(params: {
  skuCatalogId: number;
  stepLabel: string;
  stepType?: string;
  sortOrder?: number;
  status?: string;
} & QcCheckValueConfig, orgId?: OrgId): Promise<QcCheckTemplateRow> {
  const status = params.status === 'draft' ? 'draft' : 'published';
  const valueEnumJson =
    params.valueEnum != null ? JSON.stringify(params.valueEnum) : null;

  // qc_check_templates and sku_catalog are both tenant-owned. When orgId is
  // provided we stamp organization_id ($12) on the template INSERT, scope the
  // catalog-reactivation UPDATE to the org, and run both inside one
  // withTenantTransaction (GUC set). When omitted, behavior is byte-identical.
  const insertValues: unknown[] = [
    params.skuCatalogId,
    params.stepLabel.trim(),
    params.stepType?.trim() || 'PASS_FAIL',
    params.sortOrder ?? 0,
    status,
    params.valueKind ?? null,
    params.valueUnit?.trim() || null,
    valueEnumJson,
    params.passMin ?? null,
    params.passMax ?? null,
    params.failureModeId ?? null,
  ];
  if (orgId) insertValues.push(orgId);
  const insertSql = `INSERT INTO qc_check_templates
       (sku_catalog_id, step_label, step_type, sort_order, status,
        value_kind, value_unit, value_enum, pass_min, pass_max, failure_mode_id${orgId ? ', organization_id' : ''})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11${orgId ? ', $12' : ''})
     RETURNING *`;

  // Attaching a checklist makes the SKU relevant again — reactivate it so it
  // surfaces in the QC view (and the rest of the catalog) even if it had been
  // retired. Guarded so we only write when the flag is actually flipping.
  const reactivateSql = `UPDATE sku_catalog SET is_active = true, updated_at = NOW()
     WHERE id = $1 AND is_active = false${orgId ? ' AND organization_id = $2' : ''}`;

  if (orgId) {
    return await withTenantTransaction(orgId, async (client) => {
      const result = await client.query<QcCheckTemplateRow>(insertSql, insertValues);
      await client.query(reactivateSql, [params.skuCatalogId, orgId]);
      return result.rows[0];
    });
  }

  const result = await pool.query<QcCheckTemplateRow>(insertSql, insertValues);
  await pool.query(reactivateSql, [params.skuCatalogId]);
  return result.rows[0];
}

export async function updateQcCheck(
  id: number,
  updates: {
    stepLabel?: string;
    stepType?: string;
    sortOrder?: number;
    status?: string;
  } & QcCheckValueConfig,
  orgId?: OrgId,
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
  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(updates.status === 'draft' ? 'draft' : 'published');
  }
  // Structured-value config — each is independently settable (null clears).
  if (updates.valueKind !== undefined) {
    sets.push(`value_kind = $${idx++}`);
    values.push(updates.valueKind ?? null);
  }
  if (updates.valueUnit !== undefined) {
    sets.push(`value_unit = $${idx++}`);
    values.push(updates.valueUnit?.trim() || null);
  }
  if (updates.valueEnum !== undefined) {
    sets.push(`value_enum = $${idx++}::jsonb`);
    values.push(updates.valueEnum != null ? JSON.stringify(updates.valueEnum) : null);
  }
  if (updates.passMin !== undefined) {
    sets.push(`pass_min = $${idx++}`);
    values.push(updates.passMin ?? null);
  }
  if (updates.passMax !== undefined) {
    sets.push(`pass_max = $${idx++}`);
    values.push(updates.passMax ?? null);
  }
  if (updates.failureModeId !== undefined) {
    sets.push(`failure_mode_id = $${idx++}`);
    values.push(updates.failureModeId ?? null);
  }

  if (sets.length === 0) return null;
  const idPlaceholder = idx++;
  values.push(id);

  // qc_check_templates is tenant-owned. When orgId is provided we add an explicit
  // organization_id predicate (foreign-org id updates 0 rows → the 404 path) and
  // run via withTenantTransaction. When omitted, behavior is byte-identical.
  let where = `id = $${idPlaceholder}`;
  if (orgId) {
    where += ` AND organization_id = $${idx++}`;
    values.push(orgId);
  }

  const sql = `UPDATE qc_check_templates SET ${sets.join(', ')} WHERE ${where} RETURNING *`;
  const result = orgId
    ? await withTenantTransaction(orgId, (client) => client.query<QcCheckTemplateRow>(sql, values))
    : await pool.query<QcCheckTemplateRow>(sql, values);
  return result.rows[0] ?? null;
}

export async function deleteQcCheck(id: number, orgId?: OrgId): Promise<boolean> {
  // qc_check_templates is tenant-owned. When orgId is provided we add an explicit
  // organization_id predicate and run via withTenantTransaction; when omitted,
  // behavior is byte-identical to before.
  const sql = `DELETE FROM qc_check_templates WHERE id = $1${orgId ? ' AND organization_id = $2' : ''}`;
  const result = orgId
    ? await withTenantTransaction(orgId, (client) => client.query(sql, [id, orgId]))
    : await pool.query(sql, [id]);
  return (result.rowCount || 0) > 0;
}

// ─── Platform ID CRUD (delete) ─────────────────────────────────────────────

export async function updateSkuPlatformId(
  id: number,
  updates: { platform?: string; platformSku?: string | null; platformItemId?: string | null; accountName?: string | null },
  orgId?: OrgId,
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
  const idPlaceholder = idx++;
  values.push(id);
  let where = `id = $${idPlaceholder}`;
  if (orgId) {
    where += ` AND organization_id = $${idx++}`;
    values.push(orgId);
  }

  const sql = `UPDATE sku_platform_ids SET ${sets.join(', ')} WHERE ${where} RETURNING *`;
  const result = orgId
    ? await tenantQuery<SkuPlatformIdRow>(orgId, sql, values)
    : await pool.query<SkuPlatformIdRow>(sql, values);
  return result.rows[0] ?? null;
}

export async function deleteSkuPlatformId(id: number, orgId?: OrgId): Promise<boolean> {
  const sql = `UPDATE sku_platform_ids SET is_active = false WHERE id = $1${orgId ? ' AND organization_id = $2' : ''}`;
  const result = orgId
    ? await tenantQuery(orgId, sql, [id, orgId])
    : await pool.query(sql, [id]);
  return (result.rowCount || 0) > 0;
}
