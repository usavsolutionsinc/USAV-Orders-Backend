import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizePSTTimestamp } from '@/utils/date';

/**
 * GET /api/tech/orders-without-manual?techId=3&days=365
 *
 * Returns distinct orders processed by the given tech that do not yet have
 * an assigned manual record in product_manuals.
 *
 * Query mirrors /api/tech-logs exactly (LEFT JOIN LATERAL for FBA + orders,
 * same field set) but:
 *  - DISTINCT ON (o.id) — one row per order
 *  - product_manuals assigned-status filter
 *  - Rolling days window (no Mon–Fri weekly slice)
 *  - Sorted ASC by created_at (oldest unresolved first)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const techId = parseInt(searchParams.get('techId') || '0', 10);
    const days = Math.min(
      Math.max(parseInt(searchParams.get('days') || '365', 10), 1),
      730
    );

    if (!techId || Number.isNaN(techId)) {
      return NextResponse.json({ error: 'techId is required' }, { status: 400 });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM (
        SELECT DISTINCT ON (COALESCE(o.id::text, COALESCE(stn.tracking_number_raw, tsn.scan_ref)))
          tsn.id                                        AS tsn_id,
          tsn.created_at                                AS test_date_time,
          COALESCE(stn.tracking_number_raw, tsn.scan_ref) AS shipping_tracking_number,
          tsn.tested_by,
          o.id                                         AS id,
          CASE
            WHEN UPPER(TRIM(COALESCE(tsn.scan_ref, ''))) LIKE 'X00%' THEN 'FBA'
            ELSE o.order_id
          END                                          AS order_id,
          o.ship_by_date,
          o.created_at,
          o.item_number,
          COALESCE(
            CASE
              WHEN UPPER(TRIM(COALESCE(tsn.scan_ref, ''))) LIKE 'X00%' THEN fba.product_title
              ELSE NULL
            END,
            o.product_title
          )                                            AS product_title,
          o.quantity,
          o.condition,
          o.sku,
          o.account_source,
          o.notes,
          o.out_of_stock,
          COALESCE(o_stn.is_carrier_accepted OR o_stn.is_in_transit
            OR o_stn.is_out_for_delivery OR o_stn.is_delivered, false) AS is_shipped
        FROM tech_serial_numbers tsn
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
        LEFT JOIN LATERAL (
          SELECT product_title
          FROM fba_fnskus
          WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = UPPER(TRIM(COALESCE(tsn.scan_ref, tsn.fnsku, '')))
          LIMIT 1
        ) fba ON tsn.scan_ref IS NOT NULL AND UPPER(TRIM(COALESCE(tsn.scan_ref, ''))) LIKE 'X00%'
        LEFT JOIN LATERAL (
          SELECT
            o_match.id,
            o_match.shipment_id
          FROM orders o_match
          LEFT JOIN shipping_tracking_numbers o_match_stn ON o_match_stn.id = o_match.shipment_id
          WHERE (
            tsn.shipment_id IS NOT NULL
            AND o_match.shipment_id = tsn.shipment_id
          ) OR (
            COALESCE(stn.tracking_number_raw, '') <> ''
            AND o_match_stn.tracking_number_raw IS NOT NULL
            AND o_match_stn.tracking_number_raw != ''
            AND RIGHT(regexp_replace(UPPER(o_match_stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
                RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18)
          )
          ORDER BY
            CASE WHEN tsn.shipment_id IS NOT NULL AND o_match.shipment_id = tsn.shipment_id THEN 0 ELSE 1 END,
            o_match.created_at DESC NULLS LAST,
            o_match.id DESC
          LIMIT 1
        ) order_match ON true
        LEFT JOIN LATERAL (
          SELECT
            o.id,
            o.order_id,
            (
              SELECT wa.deadline_at
              FROM work_assignments wa
              WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
              ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                       wa.updated_at DESC, wa.id DESC LIMIT 1
            ) AS ship_by_date,
            o.created_at,
            o.item_number,
            o.product_title,
            o.quantity,
            o.condition,
            o.sku,
            o.account_source,
            o.notes,
            o.out_of_stock,
            o.shipment_id
          FROM orders o
          WHERE o.id = order_match.id
          LIMIT 1
        ) o ON true
        LEFT JOIN shipping_tracking_numbers o_stn ON o_stn.id = o.shipment_id
        WHERE tsn.tested_by = $1
          AND tsn.created_at IS NOT NULL
          AND tsn.created_at >= NOW() - ($2 * INTERVAL '1 day')
          AND COALESCE(
                CASE
                  WHEN UPPER(TRIM(COALESCE(tsn.scan_ref, ''))) LIKE 'X00%' THEN fba.product_title
                  ELSE NULL
                END,
                o.product_title
              ) IS NOT NULL
          AND TRIM(COALESCE(
                CASE
                  WHEN UPPER(TRIM(COALESCE(tsn.scan_ref, ''))) LIKE 'X00%' THEN fba.product_title
                  ELSE NULL
                END,
                o.product_title,
                ''
              )) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM product_manuals pm
            WHERE pm.is_active = TRUE
              AND pm.status = 'assigned'
              AND pm.relative_path IS NOT NULL
              AND TRIM(pm.relative_path) <> ''
              AND o.item_number IS NOT NULL
              AND o.item_number <> ''
              AND regexp_replace(UPPER(TRIM(COALESCE(pm.item_number, ''))), '[^A-Z0-9]', '', 'g') =
                  regexp_replace(UPPER(TRIM(o.item_number)), '[^A-Z0-9]', '', 'g')
          )
        ORDER BY
          COALESCE(o.id::text, COALESCE(stn.tracking_number_raw, tsn.scan_ref)),
          tsn.created_at DESC
      ) sub
      ORDER BY sub.test_date_time DESC NULLS LAST
      `,
      [techId, days]
    );

    const orders = result.rows.map((row) => ({
      id:                       row.id         ? Number(row.id)          : null,
      tsn_id:                   Number(row.tsn_id),
      order_id:                 String(row.order_id          || ''),
      product_title:            String(row.product_title     || ''),
      item_number:              row.item_number ? String(row.item_number) : null,
      sku:                      String(row.sku               || ''),
      shipping_tracking_number: row.shipping_tracking_number
                                  ? String(row.shipping_tracking_number)
                                  : null,
      quantity:                 row.quantity   ? String(row.quantity)    : null,
      condition:                row.condition  ? String(row.condition)   : null,
      is_shipped:               Boolean(row.is_shipped),
      has_manual:               false,
      test_date_time:           normalizePSTTimestamp(row.test_date_time),
    }));

    return NextResponse.json({ orders, total: orders.length });
  } catch (err: any) {
    console.error('[/api/tech/orders-without-manual] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: err?.message },
      { status: 500 }
    );
  }
}
