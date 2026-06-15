import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventory/sku-search?q=…
 *
 * Substring search by SKU OR product title. Returns up to 20 results with
 * the count of bins currently holding each SKU and the total qty across
 * those bins.
 *
 * Used by the inventory hub's SkuLocationFinder for the "find SKU /
 * product title" workflow. The /sku-stock/[sku]/bins endpoint is still the
 * source of truth for the per-SKU bin breakdown — this endpoint just helps
 * the user pick the right SKU.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) {
    return NextResponse.json({ success: true, results: [] });
  }

  try {
    // Tenant-scoped: filter sku_stock by org ($3) so we never surface another
    // tenant's SKUs, and align the bin_contents → sku_stock string join on
    // `sku` with `bc.organization_id = ss.organization_id` so a colliding SKU
    // string in another org can't inflate bin_count / total_qty.
    const result = await tenantQuery(
      ctx.organizationId,
      `SELECT
         ss.sku,
         ss.product_title,
         COALESCE(ss.stock, 0)::int                 AS stock,
         COUNT(DISTINCT bc.location_id)::int        AS bin_count,
         COALESCE(SUM(bc.qty), 0)::int              AS total_qty
       FROM sku_stock ss
       LEFT JOIN bin_contents bc ON bc.sku = ss.sku AND bc.organization_id = ss.organization_id
       WHERE (ss.sku ILIKE $1 OR ss.product_title ILIKE $1) AND ss.organization_id = $3
       GROUP BY ss.sku, ss.product_title, ss.stock
       ORDER BY
         CASE WHEN ss.sku ILIKE $2 THEN 0 ELSE 1 END,   -- exact-prefix SKU first
         ss.product_title NULLS LAST,
         ss.sku
       LIMIT 20`,
      [`%${q}%`, `${q}%`, ctx.organizationId],
    );
    return NextResponse.json({ success: true, results: result.rows });
  } catch (err: any) {
    console.error('[GET /api/inventory/sku-search] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to search SKUs' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });
