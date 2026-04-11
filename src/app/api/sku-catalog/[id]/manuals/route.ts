import { NextRequest, NextResponse } from 'next/server';
import { createManualForCatalog, updateManual, deleteManual } from '@/lib/neon/sku-catalog-queries';

/**
 * POST /api/sku-catalog/[id]/manuals — Create a manual linked to this catalog entry.
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
    const { googleFileId, displayName, type } = body;

    if (!googleFileId?.trim()) {
      return NextResponse.json({ success: false, error: 'googleFileId is required' }, { status: 400 });
    }

    const manual = await createManualForCatalog({
      skuCatalogId,
      googleFileId,
      displayName,
      type,
    });

    return NextResponse.json({ success: true, manual });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/[id]/manuals:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create manual' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/sku-catalog/[id]/manuals — Update a manual by manualId in body.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await params; // validate route param exists
    const body = await req.json();
    const { manualId, displayName, type, googleFileId } = body;

    if (!manualId) {
      return NextResponse.json({ success: false, error: 'manualId is required' }, { status: 400 });
    }

    const updated = await updateManual(Number(manualId), { displayName, type, googleFileId });
    if (!updated) {
      return NextResponse.json({ success: false, error: 'No changes or not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, manual: updated });
  } catch (error: any) {
    console.error('Error in PUT /api/sku-catalog/[id]/manuals:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update manual' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/sku-catalog/[id]/manuals — Soft-delete a manual by manualId in body.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await params;
    const body = await req.json();
    const { manualId } = body;

    if (!manualId) {
      return NextResponse.json({ success: false, error: 'manualId is required' }, { status: 400 });
    }

    const deleted = await deleteManual(Number(manualId));
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/[id]/manuals:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete manual' },
      { status: 500 },
    );
  }
}
