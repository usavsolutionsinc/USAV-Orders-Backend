import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { getSkuCatalogById } from '@/lib/neon/sku-catalog-queries';
import { getParents } from '@/lib/neon/sku-relationship-queries';

/**
 * GET /api/sku-catalog/graph/[skuId]/parents
 * All direct parents of a SKU ("what systems does this part belong to?").
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

    // Org-scope the catalog lookup: a SKU owned by another org reads as
    // "not found" here (404), which gates the parent read below — the
    // relationship reads themselves are constrained to this org's SKU set.
    const sku = await getSkuCatalogById(skuId, gate.ctx.organizationId);
    if (!sku) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    const parents = await getParents(skuId, gate.ctx.organizationId);
    return NextResponse.json({ success: true, skuId, parents });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/graph/[skuId]/parents:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch parents' },
      { status: 500 },
    );
  }
}
