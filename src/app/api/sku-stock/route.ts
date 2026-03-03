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
        id,
        stock,
        sku,
        product_title
      FROM sku_stock
    `;

    if (query) {
      params.push(`%${query}%`);
      params.push(`%${fuzzyQuery}%`);
      params.push(`%${normalizedQuery}%`);
      sql += `
        WHERE COALESCE(sku, '') ILIKE $1
           OR COALESCE(product_title, '') ILIKE $1
           OR COALESCE(product_title, '') ILIKE $2
           OR regexp_replace(lower(COALESCE(product_title, '')), '[^a-z0-9]+', '', 'g') ILIKE $3
           OR COALESCE(stock, '') ILIKE $1
      `;
    }

    params.push(limit);
    sql += `
      ORDER BY COALESCE(NULLIF(regexp_replace(COALESCE(stock, ''), '[^0-9-]+', '', 'g'), ''), '0')::integer DESC,
               COALESCE(product_title, '') ASC,
               COALESCE(sku, '') ASC,
               id DESC
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
