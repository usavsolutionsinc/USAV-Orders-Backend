import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { PartLinkNotAPartBody } from '@/lib/schemas/part-link';
import { markNotAPart } from '@/lib/inventory/part-links';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { withTenantTransaction } from '@/lib/tenancy/db';

/**
 * POST /api/inventory/parts/links/not-a-part — acknowledge a `-P` logical part
 * as not actually a part. Clears any confirmed parent edges for that child.
 *
 * Body: { childLogicalKey, childBase }
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = await req.json().catch(() => ({}));
      const parsed = parseBody(PartLinkNotAPartBody, raw);
      if (parsed instanceof NextResponse) return parsed;

      const link = await markNotAPart(
        ctx.organizationId,
        parsed.childLogicalKey,
        parsed.childBase,
        ctx.staffId,
      );

      await withTenantTransaction(ctx.organizationId, async (client) => {
        await recordAudit(client, ctx, req, {
          source: 'parts-graph-api',
          action: AUDIT_ACTION.PART_LINK_MARK_NOT_PART,
          entityType: AUDIT_ENTITY.PART_LINK,
          entityId: link.id,
          before: null,
          after: { ...link },
        });
      });

      return NextResponse.json({ success: true, link }, { status: 201 });
    } catch (error: any) {
      console.error('POST /api/inventory/parts/links/not-a-part error', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to mark not-a-part' },
        { status: 500 },
      );
    }
  },
  { permission: 'sku_stock.manage' },
);
