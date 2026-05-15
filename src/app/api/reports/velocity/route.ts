import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tier = searchParams.get('tier');
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '200', 10) || 200, 1),
      2000,
    );
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (tier === 'A' || tier === 'B' || tier === 'C' || tier === 'D') {
      params.push(tier);
      clauses.push(`velocity_tier = $${params.length}`);
    }
    params.push(limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT sku, product_title, current_stock, out_qty, in_qty,
              last_move_at, velocity_tier
       FROM mv_sku_velocity_30d
       ${where}
       ORDER BY out_qty DESC, in_qty DESC
       LIMIT $${params.length}`,
      params,
    );
    return NextResponse.json({ success: true, rows: r.rows });
  } catch (err: any) {
    console.error('[GET /api/reports/velocity] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed' },
      { status: 500 },
    );
  }
}
