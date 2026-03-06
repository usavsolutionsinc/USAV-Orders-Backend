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

export async function GET(req: NextRequest) {
  try {
    const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
    const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

    const categoryId = req.nextUrl.searchParams.get('categoryId');
    if (!categoryId) {
      return NextResponse.json({ success: false, error: 'categoryId is required' }, { status: 400 });
    }

    const products = await fetchProductsByCategory(storeId, token, categoryId);

    return NextResponse.json(
      { success: true, products, total: products.length },
      { headers: { 'Cache-Control': 'private, max-age=120' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Ecwid repair products error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function fetchProductsByCategory(
  storeId: string,
  token: string,
  categoryId: string
): Promise<EcwidProduct[]> {
  const products: EcwidProduct[] = [];
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

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  for (const key of [primaryName, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}
