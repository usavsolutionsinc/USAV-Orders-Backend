import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/fba/board
 *
 * Returns all non-shipped fba_shipment_items bucketed into three mutually exclusive groups:
 *   awaiting — PLANNED/PACKING with actual_qty = 0  (not yet scanned at pack station)
 *   packed   — actual_qty >= 1 AND status NOT IN (LABEL_ASSIGNED, SHIPPED)  (scanned, ready to print)
 *   paired   — LABEL_ASSIGNED or has tracking number attached to shipment
 */
export async function GET(_request: NextRequest) {
  try {
    const result = await pool.query(
      `SELECT
         fsi.id               AS item_id,
         fsi.fnsku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status           AS item_status,
         COALESCE(fsi.product_title, ff.product_title, fsi.fnsku) AS display_title,
         fsi.asin,
         fsi.sku,
         fsi.notes            AS item_notes,
         ff.condition          AS condition,
         fsi.ready_at,
         fsi.shipped_at,
         fs.id                AS shipment_id,
         fs.shipment_ref,
         fs.amazon_shipment_id,
         fs.due_date,
         fs.status            AS shipment_status,
         fs.destination_fc,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'tracking_number', stn.tracking_number_raw,
                 'carrier',         stn.carrier,
                 'label',           fst.label
               )
               ORDER BY fst.created_at DESC
             )
             FROM fba_shipment_tracking fst
             JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
             WHERE fst.shipment_id = fs.id
           ),
           '[]'::jsonb
         ) AS tracking_numbers
       FROM fba_shipment_items fsi
       JOIN fba_shipments fs ON fs.id = fsi.shipment_id
       LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku
       WHERE fs.status != 'SHIPPED'
         AND fsi.status != 'SHIPPED'
       ORDER BY fs.due_date ASC NULLS LAST, fs.id ASC, fsi.fnsku ASC`
    );

    const awaiting: Record<string, unknown>[] = [];
    const packed: Record<string, unknown>[] = [];
    const paired: Record<string, unknown>[] = [];

    for (const row of result.rows) {
      const status = String(row.item_status || '').toUpperCase();
      const actualQty = Number(row.actual_qty || 0);
      const trackingNumbers = row.tracking_numbers as unknown[];
      const hasTracking = Array.isArray(trackingNumbers) && trackingNumbers.length > 0;

      if (status === 'LABEL_ASSIGNED' || hasTracking) {
        paired.push(row);
      } else if (actualQty >= 1) {
        packed.push(row);
      } else {
        awaiting.push(row);
      }
    }

    return NextResponse.json({ success: true, awaiting, packed, paired });
  } catch (error: any) {
    console.error('[GET /api/fba/board]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA board' },
      { status: 500 }
    );
  }
}
