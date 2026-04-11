import { NextRequest, NextResponse } from 'next/server';
import { getUnpairedEcwidProducts } from '@/lib/neon/sku-catalog-queries';

/**
 * GET /api/sku-catalog/unpaired-ecwid
 * Returns Ecwid products not yet paired to a Zoho SKU, ordered by most ordered.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(searchParams.get('offset') || 0));

    const { items, total } = await getUnpairedEcwidProducts({ q, limit, offset });

    return NextResponse.json({ success: true, items, total });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/unpaired-ecwid:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch unpaired Ecwid products' },
      { status: 500 },
    );
  }
}
