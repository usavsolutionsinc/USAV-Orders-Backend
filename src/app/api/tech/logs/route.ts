import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * Simplified tech-logs query.
 * SAL is SoT: one query, no UNION ALL, no regex matching.
 *
 * GET /api/tech/logs?techId=1&weekStart=2026-03-24&weekEnd=2026-03-28
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const techId = Number(searchParams.get('techId'));
  const weekStart = searchParams.get('weekStart') || '';
  const weekEnd = searchParams.get('weekEnd') || '';
  const limit = Math.min(Number(searchParams.get('limit')) || 500, 2000);
  const offset = Number(searchParams.get('offset')) || 0;

  if (!techId) {
    return NextResponse.json({ error: 'techId is required' }, { status: 400 });
  }

  const cacheKey = createCacheLookupKey({ techId, weekStart, weekEnd, limit, offset });
  const isCurrentWeek = !weekStart; // no weekStart means current week
  const cacheTtl = isCurrentWeek ? 30 : 3600; // 30s current week, 1hr historical

  try {
    const cached = await getCachedJson<unknown[]>('api:tech-logs-v2', cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }

    // Date range: add 1-day buffer on each side for UTC/PST edge cases
    const dateConditions: string[] = [];
    const params: (string | number)[] = [techId];

    if (weekStart) {
      params.push(weekStart);
      dateConditions.push(`sal.created_at >= ($${params.length}::date - INTERVAL '1 day')`);
    }
    if (weekEnd) {
      params.push(weekEnd);
      dateConditions.push(`sal.created_at < ($${params.length}::date + INTERVAL '2 days')`);
    }

    const dateWhere = dateConditions.length > 0
      ? `AND ${dateConditions.join(' AND ')}`
      : '';

    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const query = `
      SELECT
        sal.id,
        sal.id AS source_row_id,
        CASE
          WHEN sal.activity_type = 'FNSKU_SCANNED' THEN 'fba_scan'
          WHEN sal.activity_type = 'TRACKING_SCANNED' AND EXISTS (
            SELECT 1 FROM tech_serial_numbers tsn2 WHERE tsn2.context_station_activity_log_id = sal.id LIMIT 1
          ) THEN 'tech_serial'
          ELSE 'tech_scan'
        END AS source_kind,
        sal.created_at,
        sal.staff_id AS tested_by,
        sal.fnsku,
        sal.shipment_id,

        -- Tracking display: carrier tracking > raw scan > fnsku
        COALESCE(stn.tracking_number_raw, sal.scan_ref, sal.fnsku) AS shipping_tracking_number,

        -- Aggregate serials from TSN rows linked to this SAL
        (SELECT STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at)
         FROM tech_serial_numbers tsn
         WHERE tsn.context_station_activity_log_id = sal.id
        ) AS serial_number,

        -- Order data (via shipment_id join)
        ord_match.id AS order_db_id,
        ord_match.order_id,
        COALESCE(ff.product_title, ord_match.product_title) AS product_title,
        ord_match.item_number,
        ord_match.condition,
        COALESCE(ff.sku, ord_match.sku) AS sku,
        ord_match.quantity,
        ord_match.notes,
        COALESCE(ord_match.status_history, '[]'::jsonb) AS status_history,
        COALESCE(ord_match.account_source,
          CASE WHEN sal.fnsku IS NOT NULL THEN 'fba' ELSE NULL END
        ) AS account_source,
        ord_match.out_of_stock,
        COALESCE(order_trackings.tracking_numbers, '[]'::json) AS tracking_numbers,
        COALESCE(order_trackings.tracking_number_rows, '[]'::json) AS tracking_number_rows,
        COALESCE(
          stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered,
          false
        ) AS is_shipped,
        to_char(wa_d.deadline_at, 'YYYY-MM-DD') AS ship_by_date,

        -- FBA log FK (for lifecycle tracking)
        fl.id AS fnsku_log_id

      FROM station_activity_logs sal
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
      LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
      LEFT JOIN fba_fnsku_logs fl ON fl.station_activity_log_id = sal.id
      LEFT JOIN LATERAL (
        SELECT
          o.id,
          o.order_id,
          o.product_title,
          o.item_number,
          o.condition,
          o.sku,
          o.quantity,
          o.notes,
          o.status_history,
          o.account_source,
          o.out_of_stock,
          o.created_at
        FROM orders o
        LEFT JOIN order_shipment_links osl ON osl.order_row_id = o.id
        WHERE sal.shipment_id IS NOT NULL
          AND (
            osl.shipment_id = sal.shipment_id
            OR o.shipment_id = sal.shipment_id
          )
        ORDER BY
          CASE
            WHEN osl.shipment_id = sal.shipment_id THEN 0
            WHEN o.shipment_id = sal.shipment_id THEN 1
            ELSE 2
          END,
          CASE WHEN COALESCE(osl.is_primary, false) THEN 0 ELSE 1 END,
          o.created_at DESC NULLS LAST,
          o.id DESC
        LIMIT 1
      ) ord_match ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(t.tracking_number_raw ORDER BY t.sort_key, t.tracking_number_raw)
            FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
          '[]'::json
        ) AS tracking_numbers,
        COALESCE(
          json_agg(
            json_build_object(
              'shipment_id', t.shipment_id,
              'tracking', t.tracking_number_raw,
              'is_primary', t.is_primary
            )
            ORDER BY t.sort_key, t.tracking_number_raw
          ) FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
          '[]'::json
        ) AS tracking_number_rows
        FROM (
          SELECT DISTINCT
            osl_link.shipment_id,
            stn_link.tracking_number_raw,
            COALESCE(osl_link.is_primary, false) AS is_primary,
            CASE WHEN COALESCE(osl_link.is_primary, false) THEN 0 ELSE 1 END AS sort_key
          FROM order_shipment_links osl_link
          LEFT JOIN shipping_tracking_numbers stn_link ON stn_link.id = osl_link.shipment_id
          WHERE ord_match.id IS NOT NULL
            AND osl_link.order_row_id = ord_match.id

          UNION

          SELECT DISTINCT
            o_primary.shipment_id,
            stn_primary.tracking_number_raw,
            true AS is_primary,
            0 AS sort_key
          FROM orders o_primary
          LEFT JOIN shipping_tracking_numbers stn_primary ON stn_primary.id = o_primary.shipment_id
          WHERE ord_match.id IS NOT NULL
            AND o_primary.id = ord_match.id
        ) t
      ) order_trackings ON TRUE
      LEFT JOIN LATERAL (
        SELECT wa.deadline_at FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER' AND wa.entity_id = ord_match.id AND wa.work_type = 'TEST'
        ORDER BY
          CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
          wa.updated_at DESC, wa.id DESC
        LIMIT 1
      ) wa_d ON ord_match.id IS NOT NULL

      WHERE sal.station = 'TECH'
        AND sal.activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
        AND sal.staff_id = $1
        ${dateWhere}

      ORDER BY sal.created_at DESC NULLS LAST
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const result = await pool.query(query, params);
    const rows = result.rows;

    await setCachedJson('api:tech-logs-v2', cacheKey, rows, cacheTtl, ['tech-logs']);
    return NextResponse.json(rows, { headers: { 'x-cache': 'MISS' } });
  } catch (error: any) {
    console.error('Error fetching tech logs:', error);
    return NextResponse.json({ error: 'Failed to fetch tech logs', details: error.message }, { status: 500 });
  }
}
