import { NextRequest, NextResponse } from 'next/server';
import { pairEcwidToZoho } from '@/lib/neon/sku-catalog-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';

/**
 * POST /api/sku-catalog/pair-ecwid
 * Pair an Ecwid product to a Zoho SKU.
 * Body: { ecwidPlatformRowId: number, skuCatalogId: number }
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json();
    const { ecwidPlatformRowId, skuCatalogId } = body;

    if (!ecwidPlatformRowId || !skuCatalogId) {
      return NextResponse.json(
        { success: false, error: 'ecwidPlatformRowId and skuCatalogId are required' },
        { status: 400 },
      );
    }

    const result = await pairEcwidToZoho(Number(ecwidPlatformRowId), Number(skuCatalogId), ctx.organizationId);

    if (!result.paired) {
      return NextResponse.json(
        { success: false, error: 'Ecwid product not found or already paired' },
        { status: 404 },
      );
    }

    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.skuCatalog]);

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
}, { permission: 'sku_stock.manage' });
