import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/stock-alerts?status=open|resolved&type=LOW_STOCK&limit=
 *
 * Lists alerts produced by /api/cron/stock-alerts. Powers the future
 * /sku-stock?view=alerts surface and any digest emails.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'open';
    const type = searchParams.get('type');
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '200', 10) || 200, 1),
      1000,
    );

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status === 'open') {
      clauses.push('sa.resolved_at IS NULL');
    } else if (status === 'resolved') {
      clauses.push('sa.resolved_at IS NOT NULL');
    }
    if (type === 'LOW_STOCK' || type === 'NEVER_COUNTED' || type === 'STALE_COUNT') {
      params.push(type);
      clauses.push(`sa.alert_type = $${params.length}`);
    }
    params.push(limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const r = await pool.query(
      `SELECT sa.id, sa.sku, sa.bin_id, sa.alert_type, sa.threshold,
              sa.qty_at_trigger, sa.triggered_at, sa.resolved_at,
              l.name AS bin_name, l.barcode AS bin_barcode, l.room,
              l.row_label, l.col_label,
              bc.qty AS current_qty, bc.min_qty, bc.last_counted,
              COALESCE(
                NULLIF(ss.display_name_override, ''),
                NULLIF(ss.product_title, '')
              ) AS product_title
       FROM stock_alerts sa
       LEFT JOIN locations l ON l.id = sa.bin_id
       LEFT JOIN bin_contents bc ON bc.location_id = sa.bin_id AND bc.sku = sa.sku
       LEFT JOIN sku_stock ss ON ss.sku = sa.sku
       ${where}
       ORDER BY sa.triggered_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return NextResponse.json({ success: true, alerts: r.rows });
  } catch (err: any) {
    console.error('[GET /api/stock-alerts] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to list alerts' },
      { status: 500 },
    );
  }
}
