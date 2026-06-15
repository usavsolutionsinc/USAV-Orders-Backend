import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { getSkuCatalogById } from '@/lib/neon/sku-catalog-queries';
import { getTree } from '@/lib/neon/sku-relationship-queries';

/**
 * GET /api/sku-catalog/graph/[skuId]/tree?depth=10
 * Full descendant tree below a root SKU (recursive). Returns { edges, nodes }
 * so the client can render the whole graph without per-node round-trips.
 * `skuId` is a sku_catalog.id (integer). `depth` is clamped to 1..20.
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

    const { searchParams } = new URL(req.url);
    const depth = Math.max(1, Math.min(20, Number(searchParams.get('depth') || 10)));

    // Org-scope the root catalog lookup: a root SKU owned by another org reads
    // as "not found" here (404), which gates the tree walk below — the tree is
    // rooted at a SKU this org owns.
    const sku = await getSkuCatalogById(skuId, gate.ctx.organizationId);
    if (!sku) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    const tree = await getTree(skuId, depth, gate.ctx.organizationId);
    return NextResponse.json({ success: true, ...tree });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/graph/[skuId]/tree:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch tree' },
      { status: 500 },
    );
  }
}
