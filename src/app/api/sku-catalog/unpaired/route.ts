import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

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
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0);
    const q = (searchParams.get('q') || '').trim();

    const searchClause = q
      ? `AND (o.item_number ILIKE $3 OR o.product_title ILIKE $3 OR o.sku ILIKE $3 OR o.order_id ILIKE $3)`
      : '';
    const params: (string | number)[] = [limit, offset];
    if (q) params.push(`%${q}%`);

    const result = await pool.query(
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
         AND o.item_number IS NOT NULL
         AND BTRIM(COALESCE(o.item_number, '')) <> ''
         ${searchClause}
       GROUP BY o.item_number, o.account_source
       ORDER BY COUNT(*) DESC, MAX(o.created_at) DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT (o.item_number, o.account_source))::int AS total
       FROM orders o
       WHERE o.sku_catalog_id IS NULL
         AND o.item_number IS NOT NULL
         AND BTRIM(COALESCE(o.item_number, '')) <> ''
         ${searchClause}`,
      q ? [`%${q}%`] : [],
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
}
