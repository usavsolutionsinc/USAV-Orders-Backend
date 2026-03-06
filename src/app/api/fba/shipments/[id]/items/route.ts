import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── GET /api/fba/shipments/[id]/items ────────────────────────────────────────
// Returns all items for a specific FBA shipment with staff names joined.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const shipmentId = Number(id);
    if (!Number.isFinite(shipmentId) || shipmentId < 1) {
      return NextResponse.json({ success: false, error: 'Invalid shipment id' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         fsi.id,
         fsi.fnsku,
         fsi.product_title,
         fsi.asin,
         fsi.sku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status,
         fsi.ready_by_staff_id,
         fsi.verified_by_staff_id,
         fsi.labeled_by_staff_id,
         fsi.shipped_by_staff_id,
         fsi.ready_at,
         fsi.verified_at,
         fsi.labeled_at,
         fsi.shipped_at,
         r.name  AS ready_by_name,
         v.name  AS verified_by_name,
         l.name  AS labeled_by_name,
         sh.name AS shipped_by_name
       FROM fba_shipment_items fsi
       LEFT JOIN staff r  ON r.id  = fsi.ready_by_staff_id
       LEFT JOIN staff v  ON v.id  = fsi.verified_by_staff_id
       LEFT JOIN staff l  ON l.id  = fsi.labeled_by_staff_id
       LEFT JOIN staff sh ON sh.id = fsi.shipped_by_staff_id
       WHERE fsi.shipment_id = $1
       ORDER BY fsi.status DESC, fsi.fnsku`,
      [shipmentId]
    );

    return NextResponse.json({ success: true, items: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]/items]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch items' },
      { status: 500 }
    );
  }
}
