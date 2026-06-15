import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/sku-catalog/unpaired
 *
 * Returns distinct (item_number, account_source) combos from orders
 * that have no sku_catalog_id pairing yet.
 *
 * Query params:
 *   limit  (default 100, max 500)
 *   offset (default 0)
 *   q      (optional search filter on item_number or product_title)
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0);
    const q = (searchParams.get('q') || '').trim();

    // The search-term placeholder index differs per query (list binds it at $3
    // after limit/offset; count binds it at $1), so build the clause from the
    // actual placeholder rather than hardcoding $3 — otherwise the count query
    // references a non-existent $3 and Postgres throws 'there is no parameter $3'.
    const buildSearchClause = (searchPlaceholder: string) =>
      q
        ? `AND (o.item_number ILIKE ${searchPlaceholder} OR o.product_title ILIKE ${searchPlaceholder} OR o.sku ILIKE ${searchPlaceholder} OR o.order_id ILIKE ${searchPlaceholder})`
        : '';

    // orders is tenant-owned — scope every read on organization_id + GUC wrap.
    // Org param appended last so it lands after the optional search param.
    const params: (string | number)[] = [limit, offset];
    let listSearchPlaceholder = '';
    if (q) {
      params.push(`%${q}%`);
      listSearchPlaceholder = `$${params.length}`;
    }
    const orgPlaceholder = `$${params.length + 1}`;
    params.push(ctx.organizationId);
    const searchClause = buildSearchClause(listSearchPlaceholder);

    const result = await tenantQuery(
      ctx.organizationId,
      `SELECT
         o.item_number,
         o.account_source,
         MIN(o.product_title) AS product_title,
         MIN(o.sku) AS sku,
         COUNT(*)::int AS order_count,
         MIN(o.created_at) AS first_seen,
         MAX(o.created_at) AS last_seen
       FROM orders o
       WHERE o.sku_catalog_id IS NULL
         AND o.organization_id = ${orgPlaceholder}
         AND o.item_number IS NOT NULL
         AND BTRIM(COALESCE(o.item_number, '')) <> ''
         ${searchClause}
       GROUP BY o.item_number, o.account_source
       ORDER BY COUNT(*) DESC, MAX(o.created_at) DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    const countParams: (string | number)[] = [];
    let countSearchPlaceholder = '';
    if (q) {
      countParams.push(`%${q}%`);
      countSearchPlaceholder = `$${countParams.length}`;
    }
    const countOrgPlaceholder = `$${countParams.length + 1}`;
    countParams.push(ctx.organizationId);
    const countSearchClause = buildSearchClause(countSearchPlaceholder);

    const countResult = await tenantQuery(
      ctx.organizationId,
      `SELECT COUNT(DISTINCT (o.item_number, o.account_source))::int AS total
       FROM orders o
       WHERE o.sku_catalog_id IS NULL
         AND o.organization_id = ${countOrgPlaceholder}
         AND o.item_number IS NOT NULL
         AND BTRIM(COALESCE(o.item_number, '')) <> ''
         ${countSearchClause}`,
      countParams,
    );

    return NextResponse.json({
      success: true,
      items: result.rows,
      total: countResult.rows[0]?.total ?? 0,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[sku-catalog/unpaired] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch unpaired items' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });
