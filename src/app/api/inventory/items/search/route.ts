import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * GET /api/inventory/items/search?q=<text>&limit=20
 *
 * Searches the Zoho `items` mirror by SKU or name for the parent picker in the
 * parts-pairing UI. Scoped to active items in the caller's org. This is the
 * `items` scheme — deliberately NOT the `sku_catalog` search (the two collide on
 * the SKU string).
 */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const { searchParams } = new URL(req.url);
      const q = (searchParams.get('q') || '').trim();
      const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 20)));
      if (!q) return NextResponse.json({ success: true, items: [] });

      const like = `%${q}%`;
      const res = await tenantQuery<{ id: string; sku: string; name: string }>(
        ctx.organizationId,
        `SELECT id, sku, name
           FROM items
          WHERE organization_id = $1
            AND status = 'active'
            AND (sku ILIKE $2 OR name ILIKE $2)
          ORDER BY (sku ILIKE $3) DESC, sku
          LIMIT $4`,
        [ctx.organizationId, like, `${q}%`, limit],
      );
      return NextResponse.json({ success: true, items: res.rows });
    } catch (error: any) {
      console.error('GET /api/inventory/items/search error', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  },
  { permission: 'sku_stock.view' },
);
