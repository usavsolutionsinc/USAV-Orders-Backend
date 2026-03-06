import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── GET /api/fba/items/queue ──────────────────────────────────────────────────
// Returns individual FNSKU items from all active (non-SHIPPED) FBA shipments,
// joined with their shipment context. Used by UpNextOrder FBA tab.
// Query params: status (comma-sep, default PLANNED,READY_TO_GO,LABEL_ASSIGNED), limit
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status') || 'PLANNED,READY_TO_GO,LABEL_ASSIGNED';
    const limitRaw = Number(searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

    const statuses = statusParam
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    // Check table exists (pre-migration safety)
    const tableCheck = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fba_shipment_items') AS exists`
    );
    if (!tableCheck.rows[0]?.exists) {
      return NextResponse.json({ success: true, items: [] });
    }

    const result = await pool.query(
      `SELECT
         fsi.id           AS item_id,
         fsi.shipment_id,
         fs.shipment_ref,
         fs.destination_fc,
         fs.due_date,
         fsi.fnsku,
         fsi.product_title,
         fsi.asin,
         fsi.sku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status,
         fsi.ready_at,
         tech.name        AS assigned_tech_name
       FROM fba_shipment_items fsi
       JOIN fba_shipments fs ON fs.id = fsi.shipment_id
       LEFT JOIN staff tech ON tech.id = fs.assigned_tech_id
       WHERE fsi.status = ANY($1::fba_shipment_status_enum[])
         AND fs.status != 'SHIPPED'
       ORDER BY
         CASE fsi.status
           WHEN 'READY_TO_GO'    THEN 1
           WHEN 'PLANNED'        THEN 2
           WHEN 'LABEL_ASSIGNED' THEN 3
           ELSE 4
         END,
         fs.due_date ASC NULLS LAST,
         fsi.fnsku
       LIMIT $2`,
      [statuses, limit]
    );

    return NextResponse.json({ success: true, items: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/items/queue]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA queue' },
      { status: 500 }
    );
  }
}
