import { NextRequest, NextResponse } from 'next/server';
import { squareFetch, formatSquareErrors } from '@/lib/square/client';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { isRepairSku } from '@/utils/sku';

interface CatalogItem {
  id: string;
  type: string;
  updated_at?: string;
  item_data?: {
    name?: string;
    description?: string;
    categories?: Array<{ id: string; ordinal?: number }>;
    variations?: Array<{
      id: string;
      item_variation_data?: {
        sku?: string;
        name?: string;
        price_money?: { amount?: number; currency?: string };
      };
    }>;
  };
}

interface CatalogSearchResponse {
  objects?: CatalogItem[];
  cursor?: string;
}

/**
 * GET /api/walk-in/catalog?q=&category=
 * Fetch Square catalog items for sales (excludes -RS repair SKUs).
 * Includes category IDs on each item. Optionally filter by category.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q')?.trim().toLowerCase() || '';
    const categoryFilter = searchParams.get('category')?.trim() || '';

    const body: Record<string, unknown> = {
      object_types: ['ITEM'],
      limit: 100,
      ...(query ? { query: { text_query: { keywords: [query] } } } : {}),
    };

    const result = await squareFetch<CatalogSearchResponse>('/catalog/search', {
      method: 'POST',
      body,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: formatSquareErrors(result.errors) },
        { status: 502 },
      );
    }

    let items = result.data.objects || [];

    // Filter out items where ALL variations have -RS suffix SKUs (repair-only)
    items = items.filter((item) => {
      const variations = item.item_data?.variations || [];
      if (variations.length === 0) return true;
      return variations.some((v) => !isRepairSku(v.item_variation_data?.sku));
    });

    // Filter by category if specified
    if (categoryFilter) {
      items = items.filter((item) => {
        const cats = item.item_data?.categories || [];
        return cats.some((c) => c.id === categoryFilter);
      });
    }

    // Limit to 50
    items = items.slice(0, 50);

    return NextResponse.json({ items });
  } catch (error: unknown) {
    console.error('GET /api/walk-in/catalog error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
