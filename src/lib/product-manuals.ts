import pool from '@/lib/db';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const ECWID_PAGE_LIMIT = 100;

export interface LegacyProductManualRecord {
  id: number;
  sku: string | null;
  item_number: string | null;
  google_doc_id: string;
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
    google_doc_id: String(row.google_file_id || row.google_doc_id || ''),
    type: row.type ? String(row.type) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function upsertProductManual(params: {
  sku?: string | null;
  itemNumber?: string | null;
  googleDocIdOrUrl: string;
  type?: string | null;
}): Promise<LegacyProductManualRecord> {
  const sku = normalizeIdentifier(String(params.sku || '')) || null;
  const itemNumber = normalizeIdentifier(String(params.itemNumber || '')) || null;
  const googleDocId = extractGoogleDocId(String(params.googleDocIdOrUrl || ''));
  const type = String(params.type || '').trim() || null;

  if (!sku && !itemNumber) {
    throw new Error('sku or itemNumber is required');
  }
  if (!googleDocId) {
    throw new Error('Valid Google Doc ID/URL is required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (sku) {
      await client.query(
        'UPDATE product_manuals SET is_active = FALSE WHERE is_active = TRUE AND sku = $1 AND (type = $2 OR ($2 IS NULL AND type IS NULL))',
        [sku, type]
      );
    }
    if (itemNumber) {
      await client.query(
        'UPDATE product_manuals SET is_active = FALSE WHERE is_active = TRUE AND item_number = $1 AND (type = $2 OR ($2 IS NULL AND type IS NULL))',
        [itemNumber, type]
      );
    }

    const inserted = await client.query(
      `INSERT INTO product_manuals (sku, item_number, google_file_id, type, is_active, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       RETURNING id, sku, item_number, google_file_id, type, updated_at`,
      [sku, itemNumber, googleDocId, type]
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
