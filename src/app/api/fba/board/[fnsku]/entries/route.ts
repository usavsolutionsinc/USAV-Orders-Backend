import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/fba/board/:fnsku/entries
 *
 * Returns every non-shipped plan entry for a given FNSKU across all shipments.
 * Powers the detail-panel "plan entries" list so the user can see every day
 * this FNSKU was planned, its qty, and when it was added.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fnsku: string }> },
) {
  const { fnsku } = await params;
  const normalized = fnsku.trim().toUpperCase();

  if (!normalized) {
    return NextResponse.json({ success: false, error: 'Missing FNSKU' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `SELECT
         fsi.id            AS item_id,
         fsi.fnsku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status        AS item_status,
         COALESCE(ff.product_title, fsi.fnsku) AS display_title,
         fsi.asin,
         fsi.sku,
         fsi.notes         AS item_notes,
         ff.condition      AS condition,
         fsi.created_at    AS item_created_at,
         fs.id             AS shipment_id,
         fs.shipment_ref,
         fs.due_date,
         fs.status         AS shipment_status,
         fs.destination_fc,
         fs.amazon_shipment_id,
         fs.created_at     AS plan_created_at,
         COALESCE(
           (SELECT jsonb_agg(
             DISTINCT jsonb_build_object(
               'tracking_number', stn.tracking_number_raw,
               'carrier', stn.carrier,
               'label', fst.label
             )
           )
           FROM fba_shipment_tracking fst
           JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
           WHERE fst.shipment_id = fs.id),
           '[]'::jsonb
         ) AS tracking_numbers
       FROM fba_shipment_items fsi
       JOIN fba_shipments fs ON fs.id = fsi.shipment_id
       LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku
       WHERE UPPER(TRIM(fsi.fnsku)) = $1
         AND fsi.status != 'SHIPPED'
         AND fs.status  != 'SHIPPED'
       ORDER BY fs.due_date DESC NULLS LAST, fsi.created_at DESC`,
      [normalized],
    );

    return NextResponse.json({ success: true, entries: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/board/:fnsku/entries]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FNSKU entries' },
      { status: 500 },
    );
  }
}
