import { NextRequest, NextResponse } from 'next/server';
import { createManualForCatalog, updateManual, deleteManual, getSkuCatalogById } from '@/lib/neon/sku-catalog-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Org-ownership gate for a product_manuals row. The table has no
 * organization_id column (child-scoped) so isolation is derived from its
 * parent sku_catalog. Returns true only when the manual's parent SKU belongs
 * to this org — a cross-org (or missing) manualId returns false → caller 404s.
 */
async function manualBelongsToOrg(manualId: number, orgId: OrgId): Promise<boolean> {
  const r = await tenantQuery(
    orgId,
    `SELECT 1
       FROM product_manuals m
       JOIN sku_catalog sc ON sc.id = m.sku_catalog_id
      WHERE m.id = $1 AND sc.organization_id = $2
      LIMIT 1`,
    [manualId, orgId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * POST /api/sku-catalog/[id]/manuals — Create a manual linked to this catalog entry.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id: rawId } = await params;
    const skuCatalogId = Number(rawId);
    if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    // Org-ownership precheck on the parent SKU — a manual can only be created
    // under a catalog row this org owns (cross-org → 404, never 403).
    const parent = await getSkuCatalogById(skuCatalogId, orgId);
    if (!parent) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    const body = await req.json();
    const { googleFileId, displayName, type } = body;

    if (!googleFileId?.trim()) {
      return NextResponse.json({ success: false, error: 'googleFileId is required' }, { status: 400 });
    }

    // Thread orgId so the child INSERT runs inside withTenantTransaction and
    // the parent-ownership check happens inside the shared helper too — the
    // product_manuals row is then RLS-subject under the caller's org.
    const manual = await createManualForCatalog({
      skuCatalogId,
      googleFileId,
      displayName,
      type,
    }, orgId);

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
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    await params; // validate route param exists
    const body = await req.json();
    const { manualId, displayName, type, googleFileId } = body;

    if (!manualId) {
      return NextResponse.json({ success: false, error: 'manualId is required' }, { status: 400 });
    }

    // Org-ownership gate — only update a manual whose parent SKU this org owns.
    // updateManual itself is not org-scoped, so guard it here (cross-org → 404).
    if (!(await manualBelongsToOrg(Number(manualId), orgId))) {
      return NextResponse.json({ success: false, error: 'No changes or not found' }, { status: 404 });
    }

    // Thread orgId so the UPDATE adds a parent-org EXISTS guard and runs inside
    // withTenantTransaction (a foreign-org manualId updates 0 rows → 404 path).
    const updated = await updateManual(Number(manualId), { displayName, type, googleFileId }, orgId);
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
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    await params;
    const body = await req.json();
    const { manualId } = body;

    if (!manualId) {
      return NextResponse.json({ success: false, error: 'manualId is required' }, { status: 400 });
    }

    // Org-ownership gate — only soft-delete a manual whose parent SKU this org
    // owns. deleteManual is not org-scoped, so guard it here (cross-org → 404).
    if (!(await manualBelongsToOrg(Number(manualId), orgId))) {
      return NextResponse.json({ success: false, error: 'Manual not found' }, { status: 404 });
    }

    // Thread orgId so the soft-delete adds a parent-org EXISTS guard and runs
    // inside withTenantTransaction (defense-in-depth vs the pre-gate).
    const deleted = await deleteManual(Number(manualId), orgId);
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/[id]/manuals:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete manual' },
      { status: 500 },
    );
  }
}
