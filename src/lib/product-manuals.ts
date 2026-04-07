import pool from '@/lib/db';
import { resolveSkuCatalogId } from '@/lib/neon/sku-catalog-queries';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const ECWID_PAGE_LIMIT = 100;

export interface LegacyProductManualRecord {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  display_name: string | null;
  google_file_id: string | null;
  source_url: string | null;
  relative_path: string | null;
  folder_path: string | null;
  file_name: string | null;
  status: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  type: string | null;
  updated_at: string | null;
}

interface EcwidCategory {
  id?: number | string;
  parentId?: number | string | null;
  name?: string | null;
}

interface EcwidRawProduct {
  id?: number | string;
  name?: string | null;
  sku?: string | null;
  categoryIds?: Array<number | string>;
}

export function normalizeIdentifier(rawValue: string): string {
  const cleaned = String(rawValue || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/^0+/, '') || '';
}

export function extractGoogleDocId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const docsMatch = raw.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch?.[1]) return docsMatch[1];

  const driveMatch = raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch?.[1]) return driveMatch[1];

  const queryMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch?.[1]) return queryMatch[1];

  return raw;
}

function toLegacyManualRecord(row: any): LegacyProductManualRecord {
  return {
    id: Number(row.id),
    sku: row.sku ? String(row.sku) : null,
    item_number: row.item_number ? String(row.item_number) : null,
    product_title: row.product_title ? String(row.product_title) : null,
    display_name: row.display_name ? String(row.display_name) : null,
    google_file_id: row.google_file_id ? String(row.google_file_id) : null,
    source_url: row.source_url ? String(row.source_url) : null,
    relative_path: row.relative_path ? String(row.relative_path) : null,
    folder_path: row.folder_path ? String(row.folder_path) : null,
    file_name: row.file_name ? String(row.file_name) : null,
    status: row.status ? String(row.status) : null,
    assigned_at: row.assigned_at ? String(row.assigned_at) : null,
    assigned_by: row.assigned_by ? String(row.assigned_by) : null,
    type: row.type ? String(row.type) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function upsertProductManual(params: {
  itemNumber?: string | null;
  productTitle?: string | null;
  displayName?: string | null;
  googleDocIdOrUrl?: string | null;
  sourceUrl?: string | null;
  relativePath?: string | null;
  folderPath?: string | null;
  fileName?: string | null;
  status?: 'unassigned' | 'assigned' | 'archived' | null;
  assignedBy?: string | null;
  type?: string | null;
  skuCatalogId?: number | null;
  sku?: string | null;
}): Promise<LegacyProductManualRecord> {
  const itemNumber = normalizeIdentifier(String(params.itemNumber || '')) || null;
  const productTitle = String(params.productTitle || '').trim() || null;
  const relativePath = String(params.relativePath || '').trim() || null;
  const fileName = String(params.fileName || '').trim() || (relativePath ? relativePath.split('/').pop() || null : null);
  const displayName =
    String(params.displayName || '').trim()
    || productTitle
    || fileName
    || (itemNumber ? `${itemNumber} Manual` : null);
  const googleDocId = extractGoogleDocId(String(params.googleDocIdOrUrl || '')) || null;
  const sourceUrl = String(params.sourceUrl || '').trim() || null;
  const status = String(params.status || '').trim().toLowerCase() || 'assigned';
  const folderPath = String(params.folderPath || '').trim()
    || (status === 'assigned' && itemNumber ? `assigned/${itemNumber}` : null);
  const type = String(params.type || '').trim() || null;

  if (!itemNumber && status === 'assigned') {
    throw new Error('itemNumber is required for assigned manuals');
  }
  if (!googleDocId && !relativePath) {
    throw new Error('Valid Google Doc ID/URL or relativePath is required');
  }

  // Resolve sku_catalog_id from provided value, SKU, or item number
  let skuCatalogId = params.skuCatalogId ?? null;
  if (!skuCatalogId) {
    try {
      skuCatalogId = await resolveSkuCatalogId(
        params.sku?.trim() || null,
        itemNumber || null,
      );
    } catch { /* non-critical — proceed without */ }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = relativePath
      ? await client.query(
        `SELECT id
         FROM product_manuals
         WHERE is_active = TRUE
           AND relative_path = $1
         LIMIT 1`,
        [relativePath],
      )
      : await client.query(
        `SELECT id
         FROM product_manuals
         WHERE is_active = TRUE
           AND google_file_id = $1
           AND (
             ($2::text IS NULL AND item_number IS NULL)
             OR regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') = $2
           )
         LIMIT 1`,
        [googleDocId, itemNumber],
      );

    if ((existing.rowCount ?? 0) > 0) {
      const updated = await client.query(
        `UPDATE product_manuals
         SET sku = $2,
             item_number = $3,
             product_title = $4,
             display_name = $5,
             google_file_id = $6,
             source_url = $7,
             relative_path = $8,
             folder_path = $9,
             file_name = $10,
             status = $11,
             assigned_at = CASE WHEN $11 = 'assigned' THEN COALESCE(assigned_at, NOW()) ELSE NULL END,
             assigned_by = $12,
             type = $13,
             sku_catalog_id = COALESCE($14, sku_catalog_id),
             is_active = TRUE,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, updated_at`,
        [existing.rows[0].id, null, itemNumber, productTitle, displayName, googleDocId, sourceUrl, relativePath, folderPath, fileName, status, params.assignedBy ?? null, type, skuCatalogId],
      );

      await client.query('COMMIT');
      return toLegacyManualRecord(updated.rows[0]);
    }

    const inserted = await client.query(
      `INSERT INTO product_manuals
        (sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, is_active, updated_at, sku_catalog_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10 = 'assigned' THEN NOW() ELSE NULL END, $11, $12, TRUE, NOW(), $13)
       RETURNING id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, updated_at`,
      [null, itemNumber, productTitle, displayName, googleDocId, sourceUrl, relativePath, folderPath, fileName, status, params.assignedBy ?? null, type, skuCatalogId]
    );

    await client.query('COMMIT');
    return toLegacyManualRecord(inserted.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  for (const key of [primaryName, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}

function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export async function fetchAllEcwidCategories(): Promise<EcwidCategory[]> {
  const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
  const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

  const categories: EcwidCategory[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/categories`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(ECWID_PAGE_LIMIT));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ecwid categories request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { items?: EcwidCategory[] } | EcwidCategory[];
    const pageItems = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    categories.push(...pageItems);

    if (pageItems.length < ECWID_PAGE_LIMIT) break;
    offset += ECWID_PAGE_LIMIT;
  }

  return categories;
}

export async function fetchProductsByEcwidCategory(categoryId: string): Promise<Array<{
  id: string;
  name: string;
  sku: string;
  categoryIds: string[];
}>> {
  const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
  const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

  const products: Array<{ id: string; name: string; sku: string; categoryIds: string[] }> = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/products`);
    url.searchParams.set('category', categoryId);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(ECWID_PAGE_LIMIT));
    url.searchParams.set('enabled', 'true');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ecwid products request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { items?: EcwidRawProduct[] } | EcwidRawProduct[];
    const pageItems = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];

    for (const item of pageItems) {
      const id = asId(item.id);
      if (!id) continue;
      products.push({
        id,
        name: String(item.name || '').trim() || `Product ${id}`,
        sku: String(item.sku || '').trim(),
        categoryIds: Array.isArray(item.categoryIds) ? item.categoryIds.map((cid) => String(cid)) : [],
      });
    }

    if (pageItems.length < ECWID_PAGE_LIMIT) break;
    offset += ECWID_PAGE_LIMIT;
  }

  return products;
}

export async function fetchAllEcwidProducts(): Promise<Array<{
  id: string;
  name: string;
  sku: string;
  categoryIds: string[];
}>> {
  const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
  const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

  const products: Array<{ id: string; name: string; sku: string; categoryIds: string[] }> = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/products`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(ECWID_PAGE_LIMIT));
    url.searchParams.set('enabled', 'true');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ecwid products request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { items?: EcwidRawProduct[] } | EcwidRawProduct[];
    const pageItems = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];

    for (const item of pageItems) {
      const id = asId(item.id);
      if (!id) continue;
      products.push({
        id,
        name: String(item.name || '').trim() || `Product ${id}`,
        sku: String(item.sku || '').trim(),
        categoryIds: Array.isArray(item.categoryIds) ? item.categoryIds.map((cid) => String(cid)) : [],
      });
    }

    if (pageItems.length < ECWID_PAGE_LIMIT) break;
    offset += ECWID_PAGE_LIMIT;
  }

  return products;
}

export function buildEcwidCategoryPathMap(categories: EcwidCategory[]): Map<string, string> {
  const categoryMap = new Map<string, EcwidCategory>();
  for (const category of categories) {
    const id = asId(category.id);
    if (id) categoryMap.set(id, category);
  }

  const pathMap = new Map<string, string>();
  for (const id of Array.from(categoryMap.keys())) {
    const seen = new Set<string>();
    const names: string[] = [];
    let cursor: string | null = id;

    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = categoryMap.get(cursor);
      if (!node) break;

      const name = String(node.name || '').trim();
      if (name) names.unshift(name);
      cursor = asId(node.parentId);
    }

    pathMap.set(id, names.join(' > '));
  }

  return pathMap;
}
