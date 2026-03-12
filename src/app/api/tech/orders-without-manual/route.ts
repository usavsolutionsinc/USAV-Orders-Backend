import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/tech/orders-without-manual?techId=3&days=365
 *
 * Returns distinct orders processed by the given tech that have no active
 * product_manual with a non-empty google_file_id.
 *
 * Query mirrors /api/tech-logs exactly (LEFT JOIN LATERAL for FBA + orders,
 * same field set) but:
 *  - DISTINCT ON (o.id) — one row per order
 *  - NOT EXISTS filter for product_manuals
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
            id,
            order_id,
            (
              SELECT wa.deadline_at
              FROM work_assignments wa
              WHERE wa.entity_type = 'ORDER' AND wa.entity_id = orders.id AND wa.work_type = 'TEST'
              ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                       wa.updated_at DESC, wa.id DESC LIMIT 1
            ) AS ship_by_date,
            created_at,
            item_number,
            product_title,
            quantity,
            condition,
            sku,
            account_source,
            notes,
            out_of_stock,
            shipment_id
          FROM orders
          WHERE (
            tsn.shipment_id IS NOT NULL AND shipment_id = tsn.shipment_id
          ) OR (
            COALESCE(stn.tracking_number_raw, '') <> ''
            AND shipping_tracking_number IS NOT NULL
            AND shipping_tracking_number != ''
            AND RIGHT(regexp_replace(UPPER(shipping_tracking_number), '[^A-Z0-9]', '', 'g'), 18) =
                RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18)
          )
          ORDER BY CASE WHEN shipment_id IS NOT NULL AND shipment_id = tsn.shipment_id THEN 0 ELSE 1 END
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
            WHERE pm.is_active = true
              AND pm.google_file_id IS NOT NULL
              AND TRIM(pm.google_file_id) <> ''
              AND (
                (o.item_number IS NOT NULL AND o.item_number <> '' AND pm.item_number = o.item_number)
                OR (o.sku     IS NOT NULL AND o.sku      <> '' AND pm.sku      = o.sku)
              )
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
      test_date_time:           row.test_date_time
                                  ? new Date(row.test_date_time).toISOString()
                                  : null,
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
