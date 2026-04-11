import { NextRequest, NextResponse } from 'next/server';
import { pairEcwidToZoho } from '@/lib/neon/sku-catalog-queries';

/**
 * POST /api/sku-catalog/pair-ecwid
 * Pair an Ecwid product to a Zoho SKU.
 * Body: { ecwidPlatformRowId: number, skuCatalogId: number }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ecwidPlatformRowId, skuCatalogId } = body;

    if (!ecwidPlatformRowId || !skuCatalogId) {
      return NextResponse.json(
        { success: false, error: 'ecwidPlatformRowId and skuCatalogId are required' },
        { status: 400 },
      );
    }

    const result = await pairEcwidToZoho(Number(ecwidPlatformRowId), Number(skuCatalogId));

    if (!result.paired) {
      return NextResponse.json(
        { success: false, error: 'Ecwid product not found or already paired' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      paired: true,
      imageBackfilled: result.imageBackfilled,
    });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/pair-ecwid:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to pair' },
      { status: 500 },
    );
  }
}
