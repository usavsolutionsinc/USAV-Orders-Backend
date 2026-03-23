import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const ALLOWED_STATUSES = ['READY_TO_GO', 'OUT_OF_STOCK', 'PACKING', 'PLANNED'] as const;
type AllowedStatus = typeof ALLOWED_STATUSES[number];

/**
 * GET /api/fba/print-queue?status=READY_TO_GO
 *
 * Returns fba_shipment_items for the given status (defaults to READY_TO_GO),
 * joined with parent fba_shipments and fba_fnskus catalog metadata.
 *
 * Query params:
 *   status  — item status filter (default: READY_TO_GO)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawStatus = String(searchParams.get('status') || 'READY_TO_GO').toUpperCase();
    const status: AllowedStatus = (ALLOWED_STATUSES as readonly string[]).includes(rawStatus)
      ? rawStatus as AllowedStatus
      : 'READY_TO_GO';

    const result = await pool.query(
      `SELECT
         fsi.id               AS item_id,
         fsi.fnsku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status           AS item_status,
         fsi.product_title    AS item_product_title,
         fsi.asin,
         fsi.sku,
         fsi.ready_at,
         fsi.shipped_at,
         ff.product_title     AS catalog_product_title,
         ff.asin              AS catalog_asin,
         fs.id                AS shipment_id,
         fs.shipment_ref,
         fs.amazon_shipment_id,
         fs.due_date,
         fs.status            AS shipment_status,
         fs.destination_fc,
         COALESCE(
           fsi.product_title,
           ff.product_title,
           fsi.fnsku
         ) AS display_title
       FROM fba_shipment_items fsi
       JOIN fba_shipments fs ON fs.id = fsi.shipment_id
       LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku
       WHERE fsi.status = $1
       ORDER BY fs.due_date ASC NULLS LAST, fs.id ASC, fsi.fnsku ASC`,
      [status]
    );

    return NextResponse.json({ success: true, items: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/print-queue]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch print queue' },
      { status: 500 }
    );
  }
}
