import { NextRequest, NextResponse } from 'next/server';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const ECWID_PAGE_LIMIT = 100;

export interface EcwidProduct {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  thumbnailUrl: string | null;
  enabled: boolean;
  inStock: boolean;
  categoryIds: string[];
}

interface EcwidRawProduct {
  id?: number | string;
  name?: string | null;
  sku?: string | null;
  price?: number | null;
  thumbnailUrl?: string | null;
  enabled?: boolean;
  inStock?: boolean;
  categoryIds?: (number | string)[];
  [key: string]: unknown;
}

interface EcwidCategory {
  id?: number | string;
  parentId?: number | string | null;
  name?: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
    const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 10);
    const offsetRaw = Number(req.nextUrl.searchParams.get('offset') || 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 10;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const mode = String(req.nextUrl.searchParams.get('mode') || '').trim().toLowerCase();
    const categoryId = req.nextUrl.searchParams.get('categoryId');

    if (mode === 'all') {
      const [products, categories] = await Promise.all([
        fetchAllProducts(storeId, token),
        fetchAllEcwidCategories(storeId, token),
      ]);

      const categoryMap = buildCategoryMap(categories);
      const configuredRootIds = parseConfiguredCategoryIds(process.env.ECWID_REPAIR_CATEGORY_IDS);
      const rootIds = configuredRootIds.length > 0
        ? configuredRootIds.filter((id) => categoryMap.has(id))
        : findFallbackRootIds(categories);

      const rootSet = new Set(rootIds);
      const filtered = rootSet.size === 0
        ? products
        : products.filter((product) => product.categoryIds.some((id) => isCategoryUnderRepairRoots(id, rootSet, categoryMap)));

      const page = filtered.slice(offset, offset + limit);
      const hasMore = offset + page.length < filtered.length;

      return NextResponse.json(
        { success: true, products: page, total: filtered.length, limit, offset, hasMore },
        { headers: { 'Cache-Control': 'private, max-age=120' } }
      );
    }

    if (!categoryId) {
      return NextResponse.json({ success: false, error: 'categoryId is required' }, { status: 400 });
    }

    const page = await fetchProductsByCategoryPage(storeId, token, categoryId, limit, offset);
    const hasMore = offset + page.products.length < page.total;

    return NextResponse.json(
      { success: true, products: page.products, total: page.total, limit, offset, hasMore },
      { headers: { 'Cache-Control': 'private, max-age=120' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Ecwid repair products error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function fetchAllProducts(
  storeId: string,
  token: string
): Promise<EcwidProduct[]> {
  const products: EcwidProduct[] = [];
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

    const data = (await response.json()) as { items?: EcwidRawProduct[]; total?: number } | EcwidRawProduct[];
    const pageItems: EcwidRawProduct[] = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
        ? data.items
        : [];

    for (const item of pageItems) {
      const id = item.id != null ? String(item.id) : null;
      if (!id) continue;

      products.push({
        id,
        name: String(item.name || '').trim() || `Product ${id}`,
        sku: String(item.sku || '').trim(),
        price: typeof item.price === 'number' ? item.price : null,
        thumbnailUrl: typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : null,
        enabled: item.enabled !== false,
        inStock: item.inStock !== false,
        categoryIds: Array.isArray(item.categoryIds)
          ? item.categoryIds.map((cid) => String(cid))
          : [],
      });
    }

    if (pageItems.length < ECWID_PAGE_LIMIT) break;
    offset += ECWID_PAGE_LIMIT;
  }

  return products.sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchProductsByCategoryPage(
  storeId: string,
  token: string,
  categoryId: string,
  limit: number,
  offset: number
): Promise<{ products: EcwidProduct[]; total: number }> {
  const url = new URL(`${ECWID_BASE_URL}/${storeId}/products`);
  url.searchParams.set('category', categoryId);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('enabled', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ecwid products request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { items?: EcwidRawProduct[]; total?: number } | EcwidRawProduct[];
  const pageItems: EcwidRawProduct[] = Array.isArray(data)
    ? data
    : Array.isArray(data.items)
      ? data.items
      : [];
  const total = Array.isArray(data) ? pageItems.length : Number.isFinite(data.total) ? Number(data.total) : pageItems.length;

  const products: EcwidProduct[] = pageItems
    .map((item) => {
      const id = item.id != null ? String(item.id) : null;
      if (!id) return null;

      return {
        id,
        name: String(item.name || '').trim() || `Product ${id}`,
        sku: String(item.sku || '').trim(),
        price: typeof item.price === 'number' ? item.price : null,
        thumbnailUrl: typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : null,
        enabled: item.enabled !== false,
        inStock: item.inStock !== false,
        categoryIds: Array.isArray(item.categoryIds)
          ? item.categoryIds.map((cid) => String(cid))
          : [],
      };
    })
    .filter((item): item is EcwidProduct => Boolean(item));

  return { products, total };
}

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  for (const key of [primaryName, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}

function buildCategoryMap(categories: EcwidCategory[]): Map<string, EcwidCategory> {
  const map = new Map<string, EcwidCategory>();
  for (const category of categories) {
    const id = asId(category.id);
    if (id) map.set(id, category);
  }
  return map;
}

function isCategoryUnderRepairRoots(
  categoryId: string,
  rootSet: Set<string>,
  categoryMap: Map<string, EcwidCategory>
): boolean {
  const seen = new Set<string>();
  let cursor: string | null = categoryId;

  while (cursor) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);

    if (rootSet.has(cursor)) return true;

    const node = categoryMap.get(cursor);
    if (!node) return false;
    cursor = asId(node.parentId);
  }

  return false;
}

function findFallbackRootIds(categories: EcwidCategory[]): string[] {
  const exactMatch = categories
    .filter((category) => normalizeName(String(category.name || '')) === 'bose repair service')
    .map((category) => asId(category.id))
    .filter((id): id is string => Boolean(id));

  if (exactMatch.length > 0) return exactMatch;

  return categories
    .filter((category) => {
      const name = normalizeName(String(category.name || ''));
      return name.includes('repair') && name.includes('service');
    })
    .map((category) => asId(category.id))
    .filter((id): id is string => Boolean(id));
}

function parseConfiguredCategoryIds(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

async function fetchAllEcwidCategories(storeId: string, token: string): Promise<EcwidCategory[]> {
  const categories: EcwidCategory[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/categories`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(ECWID_PAGE_LIMIT));

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ecwid category list request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { items?: EcwidCategory[] } | EcwidCategory[];
    const pageItems = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    categories.push(...pageItems);

    if (pageItems.length < ECWID_PAGE_LIMIT) break;
    offset += ECWID_PAGE_LIMIT;
  }

  return categories;
}
