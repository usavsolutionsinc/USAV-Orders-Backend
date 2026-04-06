import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/fba/shipments/active-with-details
 *
 * Returns ALL non-archived shipments (PLANNED, READY_TO_GO, LABEL_ASSIGNED)
 * plus recently shipped ones — each with nested items + tracking + allocations.
 *
 * This consolidates what previously required 2 + 2N API calls:
 *   - GET /api/fba/shipments?status=PLANNED,READY_TO_GO,LABEL_ASSIGNED
 *   - GET /api/fba/shipments?status=SHIPPED&limit=10
 *   - For each shipment with tracking: GET /api/fba/shipments/[id]/items
 *   - For each shipment with tracking: GET /api/fba/shipments/[id]/tracking
 *
 * Now returns everything in a single round-trip.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shippedLimit = Math.min(Math.max(Number(searchParams.get('shippedLimit')) || 10, 1), 50);

    const result = await pool.query(
      `
      WITH target_shipments AS (
        -- All active (non-shipped) shipments
        SELECT id, 0 AS sort_bucket FROM fba_shipments
        WHERE status IN ('PLANNED', 'READY_TO_GO', 'LABEL_ASSIGNED')
        UNION ALL
        -- Recently shipped (limited)
        SELECT id, 1 AS sort_bucket FROM fba_shipments
        WHERE status = 'SHIPPED'
        ORDER BY updated_at DESC
        LIMIT $1
      )
      SELECT
        fs.id,
        fs.shipment_ref,
        fs.amazon_shipment_id,
        fs.destination_fc,
        fs.due_date,
        fs.status,
        fs.notes,
        fs.shipped_at,
        fs.created_at,
        fs.updated_at,
        fs.created_by_staff_id,
        fs.assigned_tech_id,
        fs.assigned_packer_id,
        creator.name AS created_by_name,
        tech.name    AS assigned_tech_name,
        packer.name  AS assigned_packer_name,

        -- Aggregate item counts inline (no denormalized counters needed)
        COALESCE(item_agg.total_items, 0)         AS total_items,
        COALESCE(item_agg.ready_items, 0)          AS ready_items,
        COALESCE(item_agg.labeled_items, 0)        AS labeled_items,
        COALESCE(item_agg.shipped_items, 0)        AS shipped_items,
        COALESCE(item_agg.total_expected_qty, 0)   AS total_expected_qty,
        COALESCE(item_agg.total_actual_qty, 0)     AS total_actual_qty,

        -- Nested items array
        COALESCE(item_agg.items, '[]'::jsonb)      AS items,

        -- Nested tracking array (with allocations per tracking number)
        COALESCE(tracking_agg.tracking, '[]'::jsonb) AS tracking

      FROM target_shipments ts
      JOIN fba_shipments fs ON fs.id = ts.id
      LEFT JOIN staff creator ON creator.id = fs.created_by_staff_id
      LEFT JOIN staff tech    ON tech.id    = fs.assigned_tech_id
      LEFT JOIN staff packer  ON packer.id  = fs.assigned_packer_id

      -- Lateral join: items for this shipment
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int                                                     AS total_items,
          COUNT(*) FILTER (WHERE fsi.status = 'READY_TO_GO')::int           AS ready_items,
          COUNT(*) FILTER (WHERE fsi.status = 'LABEL_ASSIGNED')::int        AS labeled_items,
          COUNT(*) FILTER (WHERE fsi.status = 'SHIPPED')::int               AS shipped_items,
          COALESCE(SUM(fsi.expected_qty), 0)::int                           AS total_expected_qty,
          COALESCE(SUM(fsi.actual_qty), 0)::int                             AS total_actual_qty,
          jsonb_agg(
            jsonb_build_object(
              'id',                   fsi.id,
              'fnsku',                fsi.fnsku,
              'display_title',        COALESCE(ff.product_title, fsi.fnsku),
              'product_title',        fsi.product_title,
              'asin',                 fsi.asin,
              'sku',                  fsi.sku,
              'expected_qty',         fsi.expected_qty,
              'actual_qty',           fsi.actual_qty,
              'status',               fsi.status,
              'notes',                fsi.notes,
              'ready_by_staff_id',    fsi.ready_by_staff_id,
              'verified_by_staff_id', fsi.verified_by_staff_id,
              'labeled_by_staff_id',  fsi.labeled_by_staff_id,
              'shipped_by_staff_id',  fsi.shipped_by_staff_id,
              'ready_at',             fsi.ready_at,
              'verified_at',          fsi.verified_at,
              'labeled_at',           fsi.labeled_at,
              'shipped_at',           fsi.shipped_at,
              'ready_by_name',        r.name,
              'verified_by_name',     v.name,
              'labeled_by_name',      l.name,
              'shipped_by_name',      sh.name
            )
            ORDER BY fsi.status DESC, fsi.fnsku
          ) AS items
        FROM fba_shipment_items fsi
        LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku
        LEFT JOIN staff r  ON r.id  = fsi.ready_by_staff_id
        LEFT JOIN staff v  ON v.id  = fsi.verified_by_staff_id
        LEFT JOIN staff l  ON l.id  = fsi.labeled_by_staff_id
        LEFT JOIN staff sh ON sh.id = fsi.shipped_by_staff_id
        WHERE fsi.shipment_id = fs.id
      ) item_agg ON true

      -- Lateral join: tracking for this shipment (with allocations)
      LEFT JOIN LATERAL (
        SELECT
          jsonb_agg(
            jsonb_build_object(
              'link_id',                fst.id,
              'label',                  fst.label,
              'linked_at',              fst.created_at,
              'tracking_id',            stn.id,
              'tracking_number_raw',    stn.tracking_number_raw,
              'carrier',                stn.carrier,
              'latest_status_category', stn.latest_status_category,
              'latest_status_description', stn.latest_status_description,
              'is_delivered',           stn.is_delivered,
              'is_in_transit',          stn.is_in_transit,
              'has_exception',          stn.has_exception,
              'latest_event_at',        stn.latest_event_at,
              'allocations',            COALESCE(
                (
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'shipment_item_id', fta.shipment_item_id,
                      'qty',              fta.qty,
                      'fnsku',            alloc_item.fnsku,
                      'display_title',    COALESCE(NULLIF(TRIM(alloc_item.product_title), ''), alloc_item.fnsku)
                    )
                    ORDER BY fta.shipment_item_id
                  )
                  FROM fba_tracking_item_allocations fta
                  JOIN fba_shipment_items alloc_item ON alloc_item.id = fta.shipment_item_id
                  WHERE fta.shipment_id = fst.shipment_id AND fta.tracking_id = fst.tracking_id
                ),
                '[]'::jsonb
              )
            )
            ORDER BY fst.created_at DESC
          ) AS tracking
        FROM fba_shipment_tracking fst
        JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
        WHERE fst.shipment_id = fs.id
      ) tracking_agg ON true

      ORDER BY ts.sort_bucket, fs.updated_at DESC
      `,
      [shippedLimit]
    );

    // Split into active vs shipped for the frontend
    const active = result.rows.filter((r: any) => r.status !== 'SHIPPED');
    const shipped = result.rows.filter((r: any) => r.status === 'SHIPPED');

    return NextResponse.json({
      success: true,
      active,
      shipped,
    });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/active-with-details]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch active shipments' },
      { status: 500 }
    );
  }
}
