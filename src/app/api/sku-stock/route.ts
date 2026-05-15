import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = String(searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '250', 10) || 250, 1), 1000);

    const params: any[] = [];
    const fuzzyQuery = query.replace(/\s+/g, '%');
    const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, '');
    let sql = `
      SELECT
        ss.id,
        ss.stock,
        ss.sku,
        COALESCE(
          NULLIF(ss.display_name_override, ''),
          sp.display_name,
          sc.product_title,
          NULLIF(ss.product_title, '')
        ) AS product_title,
        ss.display_name_override
      FROM sku_stock ss
      LEFT JOIN sku_catalog sc ON sc.sku = ss.sku
      LEFT JOIN LATERAL (
        SELECT e.display_name
        FROM sku_platform_ids e
        WHERE e.sku_catalog_id = sc.id
          AND e.platform = 'ecwid'
          AND e.is_active = true
          AND e.display_name IS NOT NULL
        LIMIT 1
      ) sp ON TRUE
    `;

    if (query) {
      params.push(`%${query}%`);
      params.push(`%${fuzzyQuery}%`);
      params.push(`%${normalizedQuery}%`);
      sql += `
        WHERE COALESCE(ss.sku, '') ILIKE $1
           OR COALESCE(sp.display_name, sc.product_title, ss.product_title, '') ILIKE $1
           OR COALESCE(sp.display_name, sc.product_title, ss.product_title, '') ILIKE $2
           OR regexp_replace(lower(COALESCE(sp.display_name, sc.product_title, ss.product_title, '')), '[^a-z0-9]+', '', 'g') ILIKE $3
           OR COALESCE(ss.stock::text, '') ILIKE $1
      `;
    }

    params.push(limit);
    sql += `
      ORDER BY COALESCE(ss.stock, 0) DESC,
               COALESCE(sp.display_name, sc.product_title, ss.product_title, '') ASC,
               COALESCE(ss.sku, '') ASC,
               ss.id DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(sql, params);

    return NextResponse.json({
      rows: result.rows,
      count: result.rows.length,
      query,
    });
  } catch (error: any) {
    console.error('Error in GET /api/sku-stock:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SKU stock records', details: error.message },
      { status: 500 }
    );
  }
}
