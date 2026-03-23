import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/fba/fnskus/search?q=<query>&limit=20
 * Search the fba_fnskus catalog by fnsku, asin, sku, or product_title.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = String(searchParams.get('q') || '').trim();
  const limit = Math.min(40, Math.max(1, Number(searchParams.get('limit') || 20)));

  if (!q) return NextResponse.json({ success: true, items: [] });

  try {
    const res = await pool.query(
      `SELECT fnsku, product_title, asin, sku
       FROM fba_fnskus
       WHERE fnsku ILIKE $1
          OR asin ILIKE $1
          OR sku ILIKE $1
          OR product_title ILIKE $1
       ORDER BY
         CASE WHEN fnsku ILIKE $2 THEN 0 ELSE 1 END,
         product_title NULLS LAST
       LIMIT $3`,
      [`%${q}%`, `${q}%`, limit]
    );
    return NextResponse.json({ success: true, items: res.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/fnskus/search]', error);
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
