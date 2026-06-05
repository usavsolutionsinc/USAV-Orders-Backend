import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { getSkuCatalogById } from '@/lib/neon/sku-catalog-queries';
import { getChildren } from '@/lib/neon/sku-relationship-queries';

/**
 * GET /api/sku-catalog/graph/[skuId]/children
 * All direct children of a SKU ("what parts make up this item?").
 * `skuId` is a sku_catalog.id (integer).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ skuId: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.view');
    if (gate.denied) return gate.denied;

    const { skuId: rawId } = await params;
    const skuId = Number(rawId);
    if (!Number.isFinite(skuId) || skuId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid skuId' }, { status: 400 });
    }

    const sku = await getSkuCatalogById(skuId);
    if (!sku) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    const children = await getChildren(skuId);
    return NextResponse.json({ success: true, skuId, children });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/graph/[skuId]/children:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch children' },
      { status: 500 },
    );
  }
}
