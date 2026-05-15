import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1),
      2000,
    );
    const minDays = Math.max(parseInt(searchParams.get('minDays') || '90', 10) || 90, 0);
    const includeNever = searchParams.get('includeNeverMoved') === 'true';
    const r = await pool.query(
      `SELECT sku, product_title, stock, last_move_at, days_dormant
       FROM mv_dead_stock
       WHERE (days_dormant >= $1)
          OR ($3::boolean AND days_dormant IS NULL)
       ORDER BY days_dormant DESC NULLS LAST, stock DESC
       LIMIT $2`,
      [minDays, limit, includeNever],
    );
    return NextResponse.json({ success: true, rows: r.rows });
  } catch (err: any) {
    console.error('[GET /api/reports/dead-stock] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed' },
      { status: 500 },
    );
  }
}
