import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/sku-catalog/search?q=bose
 *
 * Searches sku_catalog by SKU / product title / UPC.
 *
 * Image resolution: we prefer the Ecwid-cached `image_url` / `display_name`
 * stored in `sku_platform_ids` (populated by the sync-ecwid-products job)
 * over the Zoho-originated values on `sku_catalog`, because some Zoho
 * images are stale or never populated. This is a pure DB join — no
 * per-product API ping to Ecwid.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const category = (searchParams.get('category') || '').trim();
    const ecwidOnly = searchParams.get('ecwidOnly') === 'true';
    const excludeSkuSuffix = (searchParams.get('excludeSkuSuffix') || '').trim();
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 20), 1), 100);

    const filterClauses: string[] = ['sc.is_active = true'];
    const params: unknown[] = [];

    if (ecwidOnly) {
      filterClauses.push(
        `EXISTS (
           SELECT 1 FROM sku_platform_ids spx
           WHERE spx.sku_catalog_id = sc.id
             AND spx.platform = 'ECWID'
             AND spx.is_active = true
         )`,
      );
    }

    if (excludeSkuSuffix) {
      params.push(`%${excludeSkuSuffix}`);
      filterClauses.push(`sc.sku NOT ILIKE $${params.length}`);
    }

    let exactIdx: number | null = null;
    if (q) {
      params.push(`%${q}%`);
      const likeIdx = params.length;
      params.push(q);
      exactIdx = params.length;
      filterClauses.push(
        `(sc.sku ILIKE $${likeIdx} OR sc.product_title ILIKE $${likeIdx} OR sc.upc ILIKE $${likeIdx})`,
      );
    }

    if (category) {
      params.push(category);
      filterClauses.push(`sc.category = $${params.length}`);
    }

    params.push(limit);
    const limitIdx = params.length;

    const orderBy = exactIdx
      ? `CASE WHEN UPPER(sc.sku) = UPPER($${exactIdx}) THEN 0 ELSE 1 END, sc.product_title ASC`
      : 'sc.product_title ASC';

    const result = await pool.query(
      `SELECT
         sc.id,
         sc.sku,
         COALESCE(sp_ecwid.display_name, sc.product_title) AS product_title,
         sc.category,
         sc.upc,
         COALESCE(sp_ecwid.image_url, sc.image_url) AS image_url,
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
       LEFT JOIN sku_platform_ids sp
         ON sp.sku_catalog_id = sc.id AND sp.is_active = true
       LEFT JOIN LATERAL (
         SELECT image_url, display_name
         FROM sku_platform_ids
         WHERE sku_catalog_id = sc.id
           AND platform = 'ECWID'
           AND is_active = true
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1
       ) sp_ecwid ON TRUE
       WHERE ${filterClauses.join(' AND ')}
       GROUP BY sc.id, sp_ecwid.image_url, sp_ecwid.display_name
       ORDER BY ${orderBy}
       LIMIT $${limitIdx}`,
      params,
    );

    return NextResponse.json({
      success: true,
      items: result.rows.map((r) => ({
        ...r,
        platform_ids:
          typeof r.platform_ids === 'string' ? JSON.parse(r.platform_ids) : r.platform_ids,
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
