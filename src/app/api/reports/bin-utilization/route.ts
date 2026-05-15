import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1),
      2000,
    );
    const room = searchParams.get('room');
    const minFill = searchParams.get('minFill');

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (room) {
      params.push(room);
      clauses.push(`room = $${params.length}`);
    }
    if (minFill) {
      const v = Number(minFill);
      if (Number.isFinite(v)) {
        params.push(v);
        clauses.push(`(fill_ratio IS NOT NULL AND fill_ratio >= $${params.length})`);
      }
    }
    params.push(limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const r = await pool.query(
      `SELECT bin_id, bin_name, barcode, room, row_label, col_label,
              capacity, in_bin, fill_ratio, sku_count
       FROM mv_bin_utilization
       ${where}
       ORDER BY fill_ratio DESC NULLS LAST, in_bin DESC
       LIMIT $${params.length}`,
      params,
    );
    return NextResponse.json({ success: true, rows: r.rows });
  } catch (err: any) {
    console.error('[GET /api/reports/bin-utilization] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed' },
      { status: 500 },
    );
  }
}
