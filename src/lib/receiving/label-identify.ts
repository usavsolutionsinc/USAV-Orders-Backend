/**
 * Resolve a Bose model string read off a product label (by the LAN vision box's
 * /identify-label OCR endpoint) to a real catalog product.
 *
 *   "Bose Wave Music System AWRCC1"  ->  { zoho_item_id, sku, sku_catalog_id, title, image }
 *
 * The label OCR gives a canonical model name; we match it against the Zoho `items`
 * master (the source of truth for what we actually receive/sell), then resolve the
 * sku_catalog row via the existing crosswalk. This powers "add an unfound item by
 * photographing its label" in the receiving flow — see
 * docs/visual-receiving-identify-plan.md and src/lib/vision-identify.ts.
 *
 * Read-only. Pairing/creation stays in the existing idempotent endpoints
 * (add-unmatched-line / resolveOrCreateSkuCatalogId).
 */
import pool from '@/lib/db';
import { resolveSkuCatalogId } from '@/lib/neon/sku-catalog-queries';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface LabelMatch {
  /** Canonical model the OCR produced, echoed back. */
  model: string;
  zoho_item_id: string | null;
  sku: string | null;
  item_name: string | null;
  sku_catalog_id: number | null;
  product_title: string | null;
  image_url: string | null;
  /** True when we resolved a real Zoho item (and ideally a catalog row). */
  resolved: boolean;
  /** How the match was made — for debugging/telemetry. */
  via: 'words' | 'code' | null;
}

interface ItemRow {
  zoho_item_id: string;
  name: string;
  sku: string | null;
  sku_catalog_id: number | null;
  product_title: string | null;
  image_url: string | null;
  quantity_on_hand: string | null;
}

const STOPWORDS = new Set(['bose', 'the', 'and', 'for', 'with']);

/** Significant words from a model name (drops "Bose"/stopwords, keeps codes). */
function significantWords(model: string): string[] {
  return model
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .slice(0, 6);
}

/** Distinctive alphanumeric model code, if any (AWRCC1, AWRC1G, 417788, AV35…). */
function codeToken(model: string): string | null {
  const codes = (model.toUpperCase().match(/[A-Z]*\d[A-Z0-9-]*/g) || []).filter(
    (t) => t.replace(/[^A-Z0-9]/g, '').length >= 3,
  );
  return codes.sort((a, b) => b.length - a.length)[0] ?? null;
}

// The sku → sku_catalog join is on a string key (sku), so when we scope to a
// tenant we MUST also align organization_id across the join (rule 3) — otherwise
// a same-SKU catalog row from another org could attach to this org's item. The
// join condition is parameterized by callers: `joinAnd` is '' (raw-pool path) or
// ' AND sc.organization_id = i.organization_id' (tenant path).
function selectClause(joinAnd: string): string {
  return `
  SELECT i.zoho_item_id, i.name, i.sku,
         sc.id AS sku_catalog_id, sc.product_title, sc.image_url,
         i.quantity_on_hand
  FROM items i
  LEFT JOIN sku_catalog sc ON sc.sku = i.sku${joinAnd}
`;
}
// Prefer items that have a catalog row, then ones in stock, then active.
const ORDER = `
  ORDER BY (sc.id IS NOT NULL) DESC,
           COALESCE(i.quantity_on_hand, 0) DESC,
           (i.status = 'active') DESC
  LIMIT 5
`;

async function queryByWords(words: string[], orgId?: OrgId): Promise<ItemRow[]> {
  if (words.length === 0) return [];
  const conds = words.map((_, k) => `i.name ILIKE '%' || $${k + 1} || '%'`).join(' AND ');
  // When orgId is present, scope the items read to the tenant ($N after the word
  // params) and align org across the string-key (sku) join; when omitted, keep
  // the exact prior raw-pool SQL/params.
  if (orgId) {
    const orgIdx = words.length + 1;
    const sql = `${selectClause(' AND sc.organization_id = i.organization_id')} WHERE ${conds} AND i.organization_id = $${orgIdx} ${ORDER}`;
    const res = await tenantQuery<ItemRow>(orgId, sql, [...words, orgId]);
    return res.rows;
  }
  const res = await pool.query<ItemRow>(`${selectClause('')} WHERE ${conds} ${ORDER}`, words);
  return res.rows;
}

async function queryByCode(code: string, orgId?: OrgId): Promise<ItemRow[]> {
  if (orgId) {
    const sql = `${selectClause(' AND sc.organization_id = i.organization_id')} WHERE i.name ILIKE '%' || $1 || '%' AND i.organization_id = $2 ${ORDER}`;
    const res = await tenantQuery<ItemRow>(orgId, sql, [code, orgId]);
    return res.rows;
  }
  const res = await pool.query<ItemRow>(`${selectClause('')} WHERE i.name ILIKE '%' || $1 || '%' ${ORDER}`, [code]);
  return res.rows;
}

/**
 * Resolve one model string to its best catalog match. Returns `resolved:false`
 * (with the model echoed) when nothing matches — the caller can then offer
 * "create new catalog entry" via resolveOrCreateSkuCatalogId.
 */
export async function resolveModelToCatalog(model: string, orgId?: OrgId): Promise<LabelMatch> {
  const empty: LabelMatch = {
    model, zoho_item_id: null, sku: null, item_name: null,
    sku_catalog_id: null, product_title: null, image_url: null, resolved: false, via: null,
  };
  const trimmed = (model || '').trim();
  if (!trimmed) return empty;

  // 1) all significant words must appear in the item name (most precise).
  let via: LabelMatch['via'] = 'words';
  let rows = await queryByWords(significantWords(trimmed), orgId);

  // 2) fall back to the distinctive model code alone (handles odd item titles).
  if (rows.length === 0) {
    const code = codeToken(trimmed);
    if (code) {
      rows = await queryByCode(code, orgId);
      via = 'code';
    }
  }
  if (rows.length === 0) return empty;

  const best = rows[0];
  // Belt-and-suspenders: resolve catalog id via the full crosswalk (sku OR the
  // zoho_item_id platform mapping) in case the direct sku join missed it. orgId
  // is the 4th positional arg (expectedTitle left undefined) so the resolver
  // scopes its own reads to this tenant when present.
  const skuCatalogId =
    best.sku_catalog_id ?? (await resolveSkuCatalogId(best.sku, best.zoho_item_id, undefined, orgId));

  return {
    model: trimmed,
    zoho_item_id: best.zoho_item_id,
    sku: best.sku,
    item_name: best.name,
    sku_catalog_id: skuCatalogId,
    product_title: best.product_title ?? best.name,
    image_url: best.image_url,
    resolved: best.zoho_item_id != null,
    via,
  };
}

/** Resolve several candidate model strings, de-duped, order preserved. */
export async function resolveModels(models: string[], orgId?: OrgId): Promise<LabelMatch[]> {
  const distinct = [...new Set(models.map((m) => (m || '').trim()).filter(Boolean))].slice(0, 8);
  // Explicit arrow so Array.map's index isn't passed as orgId; threads the
  // optional tenant scope through to each resolve. orgId omitted = prior behavior.
  return Promise.all(distinct.map((m) => resolveModelToCatalog(m, orgId)));
}
