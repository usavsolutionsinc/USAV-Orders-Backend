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

    const result = await pool.query(
      `
        SELECT product_title, asin, sku, fnsku
        FROM fba_fnskus
        ${whereSql}
        ORDER BY COALESCE(product_title, '') ASC, COALESCE(fnsku, '') ASC
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
        INSERT INTO fba_fnskus (product_title, asin, sku, fnsku)
        VALUES ($1, $2, $3, $4)
      `,
      [productTitle || null, asin || null, sku || null, fnsku]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to create fba_fnskus row:', error);
    return NextResponse.json({ error: 'Failed to create fba_fnskus row' }, { status: 500 });
  }
}
