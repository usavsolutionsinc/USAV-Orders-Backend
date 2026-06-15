import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getReceivingAuditPO,
  listReceivingAuditPOs,
} from '@/lib/audit-log/receiving-aggregator';

/**
 * GET /api/audit-log/receiving
 *   ?po=<zoho_purchaseorder_id>  → full timeline for one PO
 *   no `po`                       → most-recently-touched POs (paged)
 *   ?q=<search>                   → matches PO id, PO number, sku, item name
 *   ?limit=&offset=               → pagination
 *
 * Gate: admin.view_logs.
 */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const orgId = ctx.organizationId;
    const { searchParams } = req.nextUrl;
    const po = searchParams.get('po')?.trim() || null;

    try {
      if (po) {
        const detail = await getReceivingAuditPO(po, orgId);
        if (!detail) {
          return NextResponse.json(
            { success: false, error: 'PO not found' },
            { status: 404 },
          );
        }
        return NextResponse.json({ success: true, ...detail });
      }

      const limitRaw = parseInt(searchParams.get('limit') || '25', 10);
      const offsetRaw = parseInt(searchParams.get('offset') || '0', 10);
      const search = searchParams.get('q')?.trim() || null;

      const items = await listReceivingAuditPOs(
        {
          limit: Number.isFinite(limitRaw) ? limitRaw : 25,
          offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
          search,
        },
        orgId,
      );
      return NextResponse.json({ success: true, items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'audit-log read failed';
      console.error('audit-log/receiving GET failed:', err);
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
  },
  { permission: 'admin.view_logs' },
);
