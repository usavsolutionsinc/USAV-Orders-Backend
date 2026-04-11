import { NextRequest, NextResponse } from 'next/server';
import { getSkuCatalogDetail, upsertSkuCatalog } from '@/lib/neon/sku-catalog-queries';

/**
 * GET /api/sku-catalog/[id] — Full detail for a single SKU catalog entry.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const detail = await getSkuCatalogDetail(id);
    if (!detail) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...detail });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch detail' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/sku-catalog/[id] — Update a SKU catalog entry.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const body = await req.json();
    const { productTitle, category, upc, ean, imageUrl } = body;

    const detail = await getSkuCatalogDetail(id);
    if (!detail) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const updated = await upsertSkuCatalog({
      sku: detail.catalog.sku,
      productTitle: productTitle ?? detail.catalog.product_title,
      category: category !== undefined ? category : detail.catalog.category,
      upc: upc !== undefined ? upc : detail.catalog.upc,
      ean: ean !== undefined ? ean : detail.catalog.ean,
      imageUrl: imageUrl !== undefined ? imageUrl : detail.catalog.image_url,
    });

    return NextResponse.json({ success: true, catalog: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/sku-catalog/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update' },
      { status: 500 },
    );
  }
}
