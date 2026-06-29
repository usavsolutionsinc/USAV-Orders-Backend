import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { removeLinkById } from '@/lib/inventory/part-links';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { withTenantTransaction } from '@/lib/tenancy/db';

/**
 * DELETE /api/inventory/parts/links/[id] — remove a pairing (a confirmed parent
 * edge, or the not_a_part acknowledgement). The delete is org-scoped, so a
 * cross-tenant or stale id reads as missing → 404.
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

    const removed = await removeLinkById(gate.ctx.organizationId, id);
    if (!removed) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    await withTenantTransaction(gate.ctx.organizationId, async (client) => {
      await recordAudit(client, gate.ctx, req, {
        source: 'parts-graph-api',
        action: AUDIT_ACTION.PART_LINK_DELETE,
        entityType: AUDIT_ENTITY.PART_LINK,
        entityId: id,
        before: { ...removed },
        after: null,
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/inventory/parts/links/[id] error', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to remove link' },
      { status: 500 },
    );
  }
}
