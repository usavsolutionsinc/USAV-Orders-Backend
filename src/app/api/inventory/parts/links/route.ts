import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { PartLinkCreateBody } from '@/lib/schemas/part-link';
import { assignParent } from '@/lib/inventory/part-links';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';

/**
 * POST /api/inventory/parts/links — assign a whole-unit parent to a logical part.
 *
 * Body: { childLogicalKey, childBase, parentItemId (items.id), qty?, notes? }
 *
 * The parent must be an active `items` row owned by this org (404 otherwise).
 * Re-assigning the same (child, parent) updates qty/notes; any prior
 * `not_a_part` acknowledgement for the child is cleared.
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = await req.json().catch(() => ({}));
      const parsed = parseBody(PartLinkCreateBody, raw);
      if (parsed instanceof NextResponse) return parsed;

      // Parent must be this org's own item (org-scoped lookup ⇒ no cross-tenant
      // pairing, and a stale/foreign id 404s instead of inserting a dangling row).
      const parent = await tenantQuery(
        ctx.organizationId,
        `SELECT id FROM items WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [parsed.parentItemId, ctx.organizationId],
      );
      if (parent.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'parentItemId not found' }, { status: 404 });
      }

      const link = await assignParent(ctx.organizationId, {
        childLogicalKey: parsed.childLogicalKey,
        childBase: parsed.childBase,
        parentItemId: parsed.parentItemId,
        qty: parsed.qty,
        notes: parsed.notes ?? null,
        createdByStaffId: ctx.staffId,
      });

      await withTenantTransaction(ctx.organizationId, async (client) => {
        await recordAudit(client, ctx, req, {
          source: 'parts-graph-api',
          action: AUDIT_ACTION.PART_LINK_CREATE,
          entityType: AUDIT_ENTITY.PART_LINK,
          entityId: link.id,
          before: null,
          after: { ...link },
        });
      });

      return NextResponse.json({ success: true, link }, { status: 201 });
    } catch (error: any) {
      console.error('POST /api/inventory/parts/links error', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to assign parent' },
        { status: 500 },
      );
    }
  },
  { permission: 'sku_stock.manage' },
);
