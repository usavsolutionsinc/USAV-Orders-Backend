import { NextRequest, NextResponse } from 'next/server';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';

interface EcwidSearchProduct {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  thumbnailUrl: string | null;
  enabled: boolean;
  inStock: boolean;
}

interface EcwidRawProduct {
  id?: number | string;
  name?: string | null;
  sku?: string | null;
  price?: number | null;
  thumbnailUrl?: string | null;
  enabled?: boolean;
  inStock?: boolean;
}

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  for (const key of [primaryName, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}

export async function GET(req: NextRequest) {
  try {
    const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
    const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);
    const query = String(req.nextUrl.searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 12), 1), 100);

    if (!query) {
      return NextResponse.json({ success: true, products: [], count: 0, query });
    }

    const url = new URL(`${ECWID_BASE_URL}/${storeId}/products`);
    url.searchParams.set('keyword', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('enabled', 'true');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ecwid product search failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { items?: EcwidRawProduct[] } | EcwidRawProduct[];
    const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];

    const products: EcwidSearchProduct[] = items
      .map((item) => {
        const id = item.id != null ? String(item.id) : '';
        if (!id) return null;
        return {
          id,
          name: String(item.name || '').trim() || `Product ${id}`,
          sku: String(item.sku || '').trim(),
          price: typeof item.price === 'number' ? item.price : null,
          thumbnailUrl: typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : null,
          enabled: item.enabled !== false,
          inStock: item.inStock !== false,
        };
      })
      .filter((product): product is EcwidSearchProduct => Boolean(product))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      success: true,
      products,
      count: products.length,
      query,
    });
  } catch (error: any) {
    console.error('GET /api/ecwid/products/search error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to search Ecwid products' },
      { status: 500 },
    );
  }
}
