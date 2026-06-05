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
import pool from '@/lib/db';

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
    if (!before) {
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
    if (!before) {
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
