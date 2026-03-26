import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const ALLOWED_STATUSES = ['READY_TO_GO', 'OUT_OF_STOCK', 'PACKING', 'PLANNED', 'LABEL_ASSIGNED'] as const;
type AllowedStatus = typeof ALLOWED_STATUSES[number];

const DEFAULT_PRINT_STATUSES: AllowedStatus[] = ['READY_TO_GO', 'OUT_OF_STOCK', 'PACKING'];

/**
 * GET /api/fba/print-queue
 *
 * Returns fba_shipment_items for print prep (default: READY_TO_GO + OUT_OF_STOCK + PACKING),
 * joined with parent fba_shipments and fba_fnskus catalog metadata.
 *
 * Query params:
 *   status — comma-separated statuses (each must be allowed), or single status
 *   date   — optional ISO date YYYY-MM-DD; filters rows to shipments with that due_date (calendar day, UTC)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawStatus = searchParams.get('status');
    const dateFilter = searchParams.get('date');

    let statuses: AllowedStatus[];
    if (rawStatus && rawStatus.trim()) {
      const parts = rawStatus.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      statuses = parts.filter((s): s is AllowedStatus =>
        (ALLOWED_STATUSES as readonly string[]).includes(s)
      ) as AllowedStatus[];
      if (statuses.length === 0) statuses = [...DEFAULT_PRINT_STATUSES];
    } else {
      statuses = [...DEFAULT_PRINT_STATUSES];
    }

    const dateIso =
      dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter.trim()) ? dateFilter.trim() : null;

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
         fsi.notes            AS item_notes,
         fsi.ready_at,
         fsi.shipped_at,
         ff.product_title     AS catalog_product_title,
         ff.asin              AS catalog_asin,
         fs.id                AS shipment_id,
         fs.shipment_ref,
         fs.amazon_shipment_id,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'link_id',            fst.id,
                 'tracking_id',        stn.id,
                 'tracking_number',    stn.tracking_number_raw,
                 'carrier',            stn.carrier,
                 'status_category',    stn.latest_status_category,
                 'status_description', stn.latest_status_description,
                 'is_delivered',       stn.is_delivered,
                 'is_in_transit',      stn.is_in_transit,
                 'has_exception',      stn.has_exception,
                 'latest_event_at',    stn.latest_event_at,
                 'label',              fst.label
               )
               ORDER BY fst.created_at DESC
             )
             FROM fba_shipment_tracking fst
             JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
             WHERE fst.shipment_id = fs.id
           ),
           '[]'::jsonb
         )                   AS tracking_numbers,
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
       WHERE fsi.status::text = ANY($1::text[])
         AND ($2::date IS NULL OR fs.due_date IS NOT NULL AND (fs.due_date AT TIME ZONE 'UTC')::date = $2::date)
       ORDER BY fs.due_date ASC NULLS LAST, fs.id ASC, fsi.fnsku ASC`,
      [statuses, dateIso]
    );

    const items = result.rows.map((row: Record<string, unknown>) => {
      const itemStatus = String(row.item_status || '');
      let pending_reason: string | null = null;
      if (itemStatus === 'OUT_OF_STOCK') pending_reason = 'out_of_stock';
      const pending_reason_note =
        row.item_notes != null && String(row.item_notes).trim()
          ? String(row.item_notes).trim()
          : null;
      return {
        ...row,
        pending_reason,
        pending_reason_note,
      };
    });

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error('[GET /api/fba/print-queue]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch print queue' },
      { status: 500 }
    );
  }
}
