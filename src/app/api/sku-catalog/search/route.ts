import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/sku-catalog/search?q=bose
 *
 * Searches sku_catalog by SKU or product title.
 * Returns matching Zoho products with their existing platform pairings.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 20), 1), 100);

    if (!q) {
      return NextResponse.json({ success: true, items: [] });
    }

    const result = await pool.query(
      `SELECT
         sc.id,
         sc.sku,
         sc.product_title,
         sc.category,
         sc.upc,
         sc.image_url,
         sc.is_active,
         COALESCE(
           json_agg(
             json_build_object(
               'platform', sp.platform,
               'platform_sku', sp.platform_sku,
               'platform_item_id', sp.platform_item_id,
               'account_name', sp.account_name
             )
           ) FILTER (WHERE sp.id IS NOT NULL),
           '[]'
         ) AS platform_ids
       FROM sku_catalog sc
       LEFT JOIN sku_platform_ids sp ON sp.sku_catalog_id = sc.id AND sp.is_active = true
       WHERE sc.is_active = true
         AND (sc.sku ILIKE $1 OR sc.product_title ILIKE $1 OR sc.upc ILIKE $1)
       GROUP BY sc.id
       ORDER BY
         CASE WHEN UPPER(sc.sku) = UPPER($2) THEN 0 ELSE 1 END,
         sc.product_title ASC
       LIMIT $3`,
      [`%${q}%`, q, limit],
    );

    return NextResponse.json({
      success: true,
      items: result.rows.map((r) => ({
        ...r,
        platform_ids: typeof r.platform_ids === 'string' ? JSON.parse(r.platform_ids) : r.platform_ids,
      })),
    });
  } catch (error: any) {
    console.error('[sku-catalog/search] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to search SKU catalog' },
      { status: 500 },
    );
  }
}
