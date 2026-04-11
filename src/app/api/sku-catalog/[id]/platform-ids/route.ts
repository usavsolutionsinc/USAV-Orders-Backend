import { NextRequest, NextResponse } from 'next/server';
import { upsertSkuPlatformId, updateSkuPlatformId, deleteSkuPlatformId } from '@/lib/neon/sku-catalog-queries';

/**
 * POST /api/sku-catalog/[id]/platform-ids — Add a platform ID pairing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const skuCatalogId = Number(rawId);
    if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const body = await req.json();
    const { platform, platformSku, platformItemId, accountName } = body;

    if (!platform?.trim()) {
      return NextResponse.json({ success: false, error: 'platform is required' }, { status: 400 });
    }
    if (!platformSku?.trim() && !platformItemId?.trim()) {
      return NextResponse.json({ success: false, error: 'platformSku or platformItemId is required' }, { status: 400 });
    }

    const row = await upsertSkuPlatformId({
      skuCatalogId,
      platform,
      platformSku,
      platformItemId,
      accountName,
    });

    return NextResponse.json({ success: true, platformId: row });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/[id]/platform-ids:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to add platform ID' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/sku-catalog/[id]/platform-ids — Update a platform ID.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await params;
    const body = await req.json();
    const { platformIdRowId, platform, platformSku, platformItemId, accountName } = body;

    if (!platformIdRowId) {
      return NextResponse.json({ success: false, error: 'platformIdRowId is required' }, { status: 400 });
    }

    const updated = await updateSkuPlatformId(Number(platformIdRowId), {
      platform,
      platformSku,
      platformItemId,
      accountName,
    });

    if (!updated) {
      return NextResponse.json({ success: false, error: 'No changes or not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, platformId: updated });
  } catch (error: any) {
    console.error('Error in PUT /api/sku-catalog/[id]/platform-ids:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update platform ID' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/sku-catalog/[id]/platform-ids — Soft-delete a platform ID.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await params;
    const body = await req.json();
    const { platformIdRowId } = body;

    if (!platformIdRowId) {
      return NextResponse.json({ success: false, error: 'platformIdRowId is required' }, { status: 400 });
    }

    const deleted = await deleteSkuPlatformId(Number(platformIdRowId));
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/[id]/platform-ids:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete platform ID' },
      { status: 500 },
    );
  }
}
