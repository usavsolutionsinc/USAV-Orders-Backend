import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * Returns SKU-level shipped aggregation for FIFO replenishment view.
 * Shows which SKUs are depleting fastest based on recent shipments,
 * cross-referenced with existing replenishment requests and Zoho stock.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.min(Number(searchParams.get('days') || '30'), 90);
    const sku = searchParams.get('sku') || null;
    const limit = Math.min(Number(searchParams.get('limit') || '100'), 500);

    const skuClause = sku
      ? `AND o.sku ILIKE '%' || $3 || '%'`
      : '';
    const params: unknown[] = [days, limit];
    if (sku) params.push(sku);

    const sql = `
      WITH shipped_agg AS (
        SELECT
          o.sku,
          MAX(o.product_title) AS product_title,
          MAX(o.account_source) AS account_source,
          COUNT(*)::int AS shipped_count,
          SUM(COALESCE(o.quantity::int, 1))::int AS shipped_qty,
          MIN(sal.created_at) AS earliest_shipped_at,
          MAX(sal.created_at) AS latest_shipped_at
        FROM orders o
        JOIN station_activity_logs sal
          ON sal.shipment_id = o.shipment_id
          AND sal.station = 'PACK'
          AND sal.activity_type = 'PACK_COMPLETED'
        WHERE sal.created_at >= NOW() - make_interval(days => $1)
          AND o.sku IS NOT NULL
          AND BTRIM(o.sku) <> ''
          AND o.shipment_id IS NOT NULL
          ${skuClause}
        GROUP BY o.sku
      )
      SELECT
        sa.*,
        ROUND(sa.shipped_qty::numeric / GREATEST($1, 1) * 7, 1) AS avg_units_per_week,
        i.zoho_item_id,
        i.quantity_available AS zoho_qty_available,
        i.quantity_on_hand AS zoho_qty_on_hand,
        i.reorder_level,
        isc.incoming_quantity AS zoho_incoming_qty,
        rr.id AS active_replenishment_id,
        rr.status AS replenishment_status,
        rr.quantity_needed AS replenishment_qty_needed,
        rr.zoho_po_number
      FROM shipped_agg sa
      LEFT JOIN items i ON i.sku = sa.sku AND i.status = 'active'
      LEFT JOIN item_stock_cache isc ON isc.zoho_item_id = i.zoho_item_id
      LEFT JOIN LATERAL (
        SELECT id, status, quantity_needed, zoho_po_number
        FROM replenishment_requests
        WHERE sku = sa.sku
          AND status NOT IN ('fulfilled', 'cancelled')
        ORDER BY created_at DESC
        LIMIT 1
      ) rr ON true
      ORDER BY sa.shipped_qty DESC, sa.shipped_count DESC
      LIMIT $2
    `;

    const result = await pool.query(sql, params);

    return NextResponse.json({
      skus: result.rows,
      count: result.rows.length,
      days,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch shipped FIFO data', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
