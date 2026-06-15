import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseFilters } from '@/lib/audit-log/filters';
import { getSkuDetail, listSkus } from '@/lib/audit-log/sku-aggregator';

/**
 * GET /api/audit-log/sku
 *   ?sku=<code>   → cross-station event feed for one SKU
 *   no `sku`      → SKUs with the most activity (paged)
 *
 * Gate: admin.view_logs.
 */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const orgId = ctx.organizationId;
    const { searchParams } = req.nextUrl;
    const filters = parseFilters(searchParams);
    const sku = searchParams.get('sku')?.trim() || null;

    try {
      if (sku) {
        const detail = await getSkuDetail(sku, filters, orgId);
        if (!detail) {
          return NextResponse.json(
            { success: false, error: 'SKU not found' },
            { status: 404 },
          );
        }
        return NextResponse.json({ success: true, ...detail });
      }
      const items = await listSkus({ filters, search: filters.q }, orgId);
      return NextResponse.json({ success: true, items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'audit-log/sku read failed';
      console.error('audit-log/sku GET failed:', err);
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
  },
  { permission: 'admin.view_logs' },
);
