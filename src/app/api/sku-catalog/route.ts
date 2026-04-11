import { NextRequest, NextResponse } from 'next/server';
import { getSkuCatalogList } from '@/lib/neon/sku-catalog-queries';

/**
 * GET /api/sku-catalog — Paginated SKU catalog list with platform/manual/QC counts.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(searchParams.get('offset') || 0));
    const sort = searchParams.get('sort') || 'az';
    const dir = searchParams.get('dir') || 'asc';
    const ecwidOnly = searchParams.get('ecwidOnly') === 'true';

    const { items, total } = await getSkuCatalogList({ q, limit, offset, sort, dir, ecwidOnly });

    return NextResponse.json({ success: true, items, total });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch SKU catalog' },
      { status: 500 },
    );
  }
}
