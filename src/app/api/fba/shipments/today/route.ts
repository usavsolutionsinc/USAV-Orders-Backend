import { NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/fba/shipments/today
 *
 * Returns today's PLANNED shipment and its items (for duplicate detection).
 * "Today" is based on the server's local date (due_date = CURRENT_DATE).
 *
 * Response:
 * {
 *   success: true,
 *   shipment: { id, shipment_ref, due_date, items: [{ id, fnsku, expected_qty, status }] } | null
 * }
 */
export async function GET() {
  try {
    const shipRes = await pool.query(`
      SELECT id, shipment_ref, due_date, status
      FROM fba_shipments
      WHERE due_date = CURRENT_DATE AND status = 'PLANNED'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (shipRes.rows.length === 0) {
      return NextResponse.json({ success: true, shipment: null });
    }

    const shipment = shipRes.rows[0];

    const itemsRes = await pool.query(`
      SELECT fsi.id, fsi.fnsku, fsi.expected_qty, fsi.status,
             COALESCE(fsi.product_title, ff.product_title, fsi.fnsku) AS display_title,
             fsi.asin, fsi.sku,
             fsi.ready_by_staff_id,
             fsi.verified_by_staff_id,
             r.name  AS ready_by_name,
             v.name  AS verified_by_name
      FROM fba_shipment_items fsi
      LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku
      LEFT JOIN staff r ON r.id = fsi.ready_by_staff_id
      LEFT JOIN staff v ON v.id = fsi.verified_by_staff_id
      WHERE fsi.shipment_id = $1
      ORDER BY fsi.created_at ASC
    `, [shipment.id]);

    return NextResponse.json({
      success: true,
      shipment: {
        id: shipment.id,
        shipment_ref: shipment.shipment_ref,
        due_date: shipment.due_date,
        status: shipment.status,
        items: itemsRes.rows,
      },
    });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/today]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed' },
      { status: 500 }
    );
  }
}
