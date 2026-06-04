import { NextRequest, NextResponse } from 'next/server';
import {
  createQcCheck,
  updateQcCheck,
  deleteQcCheck,
  getQcChecks,
  getSkuCatalogById,
} from '@/lib/neon/sku-catalog-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * GET /api/sku-catalog/[id]/qc-checks — Read the QC checklist for a SKU.
 * Returns the catalog row (for the header) plus its QC check steps. Includes
 * category-scoped templates (sku_catalog_id IS NULL) that apply to the SKU's
 * category, matching getQcChecks' fallback behaviour.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.view');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const skuCatalogId = Number(rawId);
    if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const catalog = await getSkuCatalogById(skuCatalogId);
    if (!catalog) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    const checks = await getQcChecks(skuCatalogId, catalog.category);
    return NextResponse.json({ success: true, catalog, checks });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load QC checks' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/sku-catalog/[id]/qc-checks — Create a QC check step.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const skuCatalogId = Number(rawId);
    if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const body = await req.json();
    const { stepLabel, stepType, sortOrder } = body;

    if (!stepLabel?.trim()) {
      return NextResponse.json({ success: false, error: 'stepLabel is required' }, { status: 400 });
    }

    const check = await createQcCheck({
      skuCatalogId,
      stepLabel,
      stepType,
      sortOrder,
    });

    return NextResponse.json({ success: true, check });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create QC check' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/sku-catalog/[id]/qc-checks — Update a QC check by checkId in body.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    await params;
    const body = await req.json();
    const { checkId, stepLabel, stepType, sortOrder } = body;

    if (!checkId) {
      return NextResponse.json({ success: false, error: 'checkId is required' }, { status: 400 });
    }

    const updated = await updateQcCheck(Number(checkId), { stepLabel, stepType, sortOrder });
    if (!updated) {
      return NextResponse.json({ success: false, error: 'No changes or not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, check: updated });
  } catch (error: any) {
    console.error('Error in PUT /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update QC check' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/sku-catalog/[id]/qc-checks — Delete a QC check by checkId in body.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    await params;
    const body = await req.json();
    const { checkId } = body;

    if (!checkId) {
      return NextResponse.json({ success: false, error: 'checkId is required' }, { status: 400 });
    }

    const deleted = await deleteQcCheck(Number(checkId));
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete QC check' },
      { status: 500 },
    );
  }
}
