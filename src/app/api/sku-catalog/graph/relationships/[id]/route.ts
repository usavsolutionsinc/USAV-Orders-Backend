import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { SkuRelationshipUpdateBody } from '@/lib/schemas/sku-relationship';
import {
  deleteRelationship,
  getRelationshipById,
  updateRelationship,
} from '@/lib/neon/sku-relationship-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { tenantQuery } from '@/lib/tenancy/db';
import pool from '@/lib/db';

/**
 * Confirm a relationship edge belongs to `orgId`. `sku_relationships` is
 * tenant-owned (carries organization_id), but its query helpers don't take an
 * orgId yet — so we org-scope the edge here with an explicit inline check. A
 * cross-tenant id reads as missing → the caller 404s, exactly as if the edge
 * never existed.
 */
async function relationshipBelongsToOrg(id: number, orgId: string): Promise<boolean> {
  const { rows } = await tenantQuery<{ id: number }>(
    orgId,
    `SELECT id FROM sku_relationships WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId],
  );
  return rows.length > 0;
}

/**
 * PATCH /api/sku-catalog/graph/relationships/[id] — Update qty/notes on an edge.
 * The parent/child endpoints are immutable; re-pointing means delete + add.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SkuRelationshipUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getRelationshipById(id);
    if (!before || !(await relationshipBelongsToOrg(id, gate.ctx.organizationId))) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const updated = await updateRelationship(id, parsed);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'sku-graph-api',
      action: AUDIT_ACTION.SKU_RELATIONSHIP_UPDATE,
      entityType: AUDIT_ENTITY.SKU_RELATIONSHIP,
      entityId: id,
      before: { ...before },
      after: { ...updated },
    });

    return NextResponse.json({ success: true, relationship: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/sku-catalog/graph/relationships/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update relationship' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/sku-catalog/graph/relationships/[id] — Remove an edge.
 *
 * Hard-delete: an edge is just a connection — nothing references its id, and
 * removing it never touches the SKUs themselves (the catalog rows are intact).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const before = await getRelationshipById(id);
    if (!before || !(await relationshipBelongsToOrg(id, gate.ctx.organizationId))) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const removed = await deleteRelationship(id);
    if (!removed) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'sku-graph-api',
      action: AUDIT_ACTION.SKU_RELATIONSHIP_DELETE,
      entityType: AUDIT_ENTITY.SKU_RELATIONSHIP,
      entityId: id,
      before: { ...before },
      after: null,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/graph/relationships/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete relationship' },
      { status: 500 },
    );
  }
}
