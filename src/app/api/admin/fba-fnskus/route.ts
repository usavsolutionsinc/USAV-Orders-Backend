import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const limitParam = Number(searchParams.get('limit') || 200);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(1000, Math.floor(limitParam))) : 200;

    const hasQuery = q.length > 0;
    const whereSql = hasQuery
      ? `
        WHERE COALESCE(product_title, '') ILIKE $1
           OR COALESCE(asin, '') ILIKE $1
           OR COALESCE(sku, '') ILIKE $1
           OR COALESCE(fnsku, '') ILIKE $1
      `
      : '';
    const params = hasQuery ? [`%${q}%`, limit] : [limit];

    const orderSql = `
      ORDER BY
        CASE
          WHEN (product_title IS NULL OR TRIM(COALESCE(product_title, '')) = '')
           AND (asin IS NULL OR TRIM(COALESCE(asin, '')) = '')
           AND (sku IS NULL OR TRIM(COALESCE(sku, '')) = '')
          THEN 0
          ELSE 1
        END,
        CASE
          WHEN (product_title IS NULL OR TRIM(COALESCE(product_title, '')) = '')
           AND (asin IS NULL OR TRIM(COALESCE(asin, '')) = '')
           AND (sku IS NULL OR TRIM(COALESCE(sku, '')) = '')
          THEN COALESCE(fnsku, '')
          ELSE COALESCE(NULLIF(TRIM(product_title), ''), '')
        END ASC,
        COALESCE(fnsku, '') ASC
    `;

    const result = await pool.query(
      `
        SELECT product_title, asin, sku, fnsku
        FROM fba_fnskus
        ${whereSql}
        ${orderSql}
        LIMIT $${hasQuery ? 2 : 1}
      `,
      params
    );

    return NextResponse.json({ rows: result.rows });
  } catch (error: any) {
    console.error('Failed to fetch fba_fnskus rows:', error);
    return NextResponse.json({ error: 'Failed to fetch fba_fnskus rows' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const productTitle = String(body?.product_title || '').trim();
    const asin = String(body?.asin || '').trim();
    const sku = String(body?.sku || '').trim();
    const fnsku = String(body?.fnsku || '').trim().toUpperCase();

    if (!fnsku) {
      return NextResponse.json({ error: 'fnsku is required' }, { status: 400 });
    }

    await pool.query(
      `
        INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, is_active, last_seen_at, updated_at)
        VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
        ON CONFLICT (fnsku) DO UPDATE
          SET product_title = EXCLUDED.product_title,
              asin = EXCLUDED.asin,
              sku = EXCLUDED.sku,
              is_active = TRUE,
              last_seen_at = NOW(),
              updated_at = NOW()
      `,
      [fnsku, productTitle || null, asin || null, sku || null]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to create fba_fnskus row:', error);
    return NextResponse.json({ error: 'Failed to create fba_fnskus row' }, { status: 500 });
  }
}
