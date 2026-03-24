import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';
import { getCurrentPSTDateKey } from '@/utils/date';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const techId = searchParams.get('techId') || '1';
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');
  const weekStart = searchParams.get('weekStart') || '';
  const weekEnd = searchParams.get('weekEnd') || '';
  const cacheLookup = createCacheLookupKey({ techId, limit, offset, weekStart, weekEnd });

  const today = getCurrentPSTDateKey();
  const isHistoricalWeek = Boolean(weekEnd && weekEnd < today);
  const cacheTTL = isHistoricalWeek ? 86400 : 0;
  const cacheHeaders = isHistoricalWeek
    ? { 'Cache-Control': `private, max-age=${cacheTTL}, stale-while-revalidate=30` }
    : { 'Cache-Control': 'no-store' };

  try {
    const cached = isHistoricalWeek ? await getCachedJson<any[]>('api:tech-logs', cacheLookup) : null;
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...cacheHeaders } });
    }

    const techIdNum = parseInt(String(techId), 10);
    let staffResult = { rows: [] as Array<{ id: number }> };
    if (!Number.isNaN(techIdNum) && techIdNum > 0) {
      const byId = await pool.query('SELECT id FROM staff WHERE id = $1 LIMIT 1', [techIdNum]);
      if (byId.rows.length > 0) staffResult = byId;
    }

    if (staffResult.rows.length === 0) {
      const techEmployeeIds: Record<string, string> = {
        '1': 'TECH001',
        '2': 'TECH002',
        '3': 'TECH003',
        '4': 'TECH004',
      };
      const employeeId = techEmployeeIds[String(techId)] || String(techId);
      staffResult = await pool.query('SELECT id FROM staff WHERE employee_id = $1 LIMIT 1', [employeeId]);
    }

    if (staffResult.rows.length === 0) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
    }

    const staffId = staffResult.rows[0].id;
    const params: any[] = [staffId];
    let idx = 2;
    let weekClause = '';
    // For serial_rows the position is anchored to the TRACKING_SCANNED SAL
    // created_at (via the tracking_sal lateral join), so week-filtering must
    // also reference that timestamp instead of the SERIAL_ADDED SAL timestamp.
    let weekClauseSerial = '';
    if (weekStart && weekEnd) {
      weekClause = `
        AND sal.created_at >= ($${idx}::date - interval '1 day')
        AND sal.created_at <  ($${idx + 1}::date + interval '2 days')`;
      weekClauseSerial = `
        AND COALESCE(tracking_sal.created_at, sal.created_at) >= ($${idx}::date - interval '1 day')
        AND COALESCE(tracking_sal.created_at, sal.created_at) <  ($${idx + 1}::date + interval '2 days')`;
      params.push(weekStart, weekEnd);
      idx += 2;
    }
    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const result = await pool.query(
      `
      WITH tracking_scan_rows AS (
        SELECT
          (-1000000000 - sal.id)::bigint AS id,
          sal.id AS source_row_id,
          'tech_scan'::text AS source_kind,
          NULL::integer AS tech_serial_id,
          sal.created_at,
          COALESCE(stn.tracking_number_raw, sal.scan_ref) AS shipping_tracking_number,
          ''::text AS serial_number,
          sal.staff_id AS tested_by,
          order_match.shipment_id,
          o.id AS order_db_id,
          o.order_id,
          wa_deadline.deadline_at AS ship_by_date,
          o.item_number,
          o.product_title,
          o.quantity,
          o.condition,
          o.sku,
          NULL::text AS fnsku,
          o.status::text AS status,
          o.status_history,
          o.account_source,
          COALESCE(o.notes, sal.notes) AS notes,
          o.out_of_stock,
          COALESCE(o_stn.is_carrier_accepted OR o_stn.is_in_transit
            OR o_stn.is_out_for_delivery OR o_stn.is_delivered, false) AS is_shipped
        FROM station_activity_logs sal
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
        LEFT JOIN LATERAL (
          SELECT o_match.id, o_match.shipment_id
          FROM orders o_match
          LEFT JOIN shipping_tracking_numbers o_match_stn ON o_match_stn.id = o_match.shipment_id
          WHERE (
            sal.shipment_id IS NOT NULL
            AND o_match.shipment_id = sal.shipment_id
          ) OR (
            COALESCE(sal.scan_ref, stn.tracking_number_raw, '') <> ''
            AND o_match_stn.tracking_number_raw IS NOT NULL
            AND o_match_stn.tracking_number_raw != ''
            AND RIGHT(regexp_replace(UPPER(o_match_stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
                RIGHT(regexp_replace(UPPER(COALESCE(sal.scan_ref, stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18)
          )
          ORDER BY
            CASE WHEN sal.shipment_id IS NOT NULL AND o_match.shipment_id = sal.shipment_id THEN 0 ELSE 1 END,
            o_match.created_at DESC NULLS LAST,
            o_match.id DESC
          LIMIT 1
        ) order_match ON TRUE
        LEFT JOIN orders o ON o.id = order_match.id
        LEFT JOIN shipping_tracking_numbers o_stn ON o_stn.id = o.shipment_id
        LEFT JOIN LATERAL (
          SELECT wa.deadline_at
          FROM work_assignments wa
          WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
          ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                   wa.updated_at DESC, wa.id DESC LIMIT 1
        ) wa_deadline ON o.id IS NOT NULL
        WHERE sal.station = 'TECH'
          AND sal.activity_type = 'TRACKING_SCANNED'
          AND sal.staff_id = $1
          ${weekClause}
          AND NOT EXISTS (
            SELECT 1
            FROM station_activity_logs sal2
            WHERE sal2.station = 'TECH'
              AND sal2.activity_type = 'SERIAL_ADDED'
              AND sal2.staff_id = sal.staff_id
              AND (
                (sal.shipment_id IS NOT NULL AND sal2.shipment_id = sal.shipment_id)
                OR (
                  COALESCE(sal.scan_ref, '') <> ''
                  AND RIGHT(regexp_replace(UPPER(COALESCE(sal2.scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18) =
                      RIGHT(regexp_replace(UPPER(COALESCE(sal.scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18)
                )
              )
          )
      ),
      serial_rows AS (
        -- DISTINCT ON produces one row per tracking (shipment_id or scan_ref),
        -- picking the latest SERIAL_ADDED SAL entry for metadata.  The scalar
        -- subquery aggregates ALL TSN serial numbers for that tracking so that
        -- multiple scans appear as one combined row rather than split rows.
        SELECT DISTINCT ON (COALESCE(tsn.shipment_id::text, COALESCE(tsn.scan_ref, '')))
          sal.id,
          sal.id AS source_row_id,
          'tech_serial'::text AS source_kind,
          tsn.id AS tech_serial_id,
          -- Always use the original TRACKING_SCANNED SAL created_at so that
          -- adding or replacing a serial never changes the row's position.
          -- Falls back to the SERIAL_ADDED SAL created_at when no tracking
          -- scan exists (e.g. serial added without prior tracking scan).
          COALESCE(tracking_sal.created_at, sal.created_at) AS created_at,
          COALESCE(stn.tracking_number_raw, tsn.scan_ref) AS shipping_tracking_number,
          -- Aggregate every serial number linked to this shipment/scan_ref so
          -- that all serials scanned for the same tracking appear together.
          (SELECT STRING_AGG(t.serial_number, ',' ORDER BY t.created_at)
           FROM tech_serial_numbers t
           WHERE (tsn.shipment_id IS NOT NULL AND t.shipment_id = tsn.shipment_id)
              OR (tsn.shipment_id IS NULL
                  AND t.shipment_id IS NULL
                  AND tsn.scan_ref IS NOT NULL
                  AND COALESCE(t.scan_ref, '') = tsn.scan_ref)
          ) AS serial_number,
          sal.staff_id AS tested_by,
          order_match.shipment_id,
          o.id AS order_db_id,
          CASE
            WHEN UPPER(TRIM(COALESCE(tsn.fnsku, tsn.scan_ref, stn.tracking_number_raw, ''))) ~ '^(X0|B0)' THEN 'FBA'
            ELSE o.order_id
          END AS order_id,
          wa_deadline.deadline_at AS ship_by_date,
          o.item_number,
          COALESCE(
            CASE
              WHEN UPPER(TRIM(COALESCE(tsn.fnsku, tsn.scan_ref, stn.tracking_number_raw, ''))) ~ '^(X0|B0)' THEN fba.product_title
              ELSE NULL
            END,
            o.product_title
          ) AS product_title,
          o.quantity,
          COALESCE(fba.condition, o.condition) AS condition,
          COALESCE(fba.sku, o.sku) AS sku,
          tsn.fnsku AS fnsku,
          o.status::text AS status,
          o.status_history,
          COALESCE(o.account_source, CASE WHEN tsn.fnsku IS NOT NULL THEN 'fba' ELSE NULL END) AS account_source,
          COALESCE(o.notes, sal.notes) AS notes,
          o.out_of_stock,
          COALESCE(o_stn.is_carrier_accepted OR o_stn.is_in_transit
            OR o_stn.is_out_for_delivery OR o_stn.is_delivered, false) AS is_shipped
        FROM station_activity_logs sal
        JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
        -- Resolve the original TRACKING_SCANNED SAL row for this staff + tracking
        -- so we can anchor created_at to when the item was first scanned.
        LEFT JOIN LATERAL (
          SELECT ts.created_at
          FROM station_activity_logs ts
          WHERE ts.station = 'TECH'
            AND ts.activity_type = 'TRACKING_SCANNED'
            AND ts.staff_id = $1
            AND (
              (tsn.shipment_id IS NOT NULL AND ts.shipment_id = tsn.shipment_id)
              OR (
                COALESCE(tsn.scan_ref, stn.tracking_number_raw, '') <> ''
                AND RIGHT(regexp_replace(UPPER(COALESCE(ts.scan_ref, ts.metadata->>'tracking', '')), '[^A-Z0-9]', '', 'g'), 18) =
                    RIGHT(regexp_replace(UPPER(COALESCE(tsn.scan_ref, stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18)
              )
            )
          ORDER BY ts.created_at ASC
          LIMIT 1
        ) tracking_sal ON TRUE
        LEFT JOIN LATERAL (
          SELECT o_match.id, o_match.shipment_id
          FROM orders o_match
          LEFT JOIN shipping_tracking_numbers o_match_stn ON o_match_stn.id = o_match.shipment_id
          WHERE (
            tsn.shipment_id IS NOT NULL
            AND o_match.shipment_id = tsn.shipment_id
          ) OR (
            COALESCE(tsn.scan_ref, stn.tracking_number_raw, '') <> ''
            AND o_match_stn.tracking_number_raw IS NOT NULL
            AND o_match_stn.tracking_number_raw != ''
            AND RIGHT(regexp_replace(UPPER(o_match_stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
                RIGHT(regexp_replace(UPPER(COALESCE(tsn.scan_ref, stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18)
          )
          ORDER BY
            CASE WHEN tsn.shipment_id IS NOT NULL AND o_match.shipment_id = tsn.shipment_id THEN 0 ELSE 1 END,
            o_match.created_at DESC NULLS LAST,
            o_match.id DESC
          LIMIT 1
        ) order_match ON TRUE
        LEFT JOIN orders o ON o.id = order_match.id
        LEFT JOIN shipping_tracking_numbers o_stn ON o_stn.id = o.shipment_id
        LEFT JOIN LATERAL (
          SELECT wa.deadline_at
          FROM work_assignments wa
          WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
          ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                   wa.updated_at DESC, wa.id DESC LIMIT 1
        ) wa_deadline ON o.id IS NOT NULL
        LEFT JOIN LATERAL (
          SELECT product_title, sku, condition
          FROM fba_fnskus
          WHERE fnsku = COALESCE(tsn.fnsku, tsn.scan_ref)
          LIMIT 1
        ) fba ON COALESCE(tsn.fnsku, tsn.scan_ref) IS NOT NULL
        WHERE sal.station = 'TECH'
          AND sal.activity_type = 'SERIAL_ADDED'
          AND sal.staff_id = $1
          ${weekClauseSerial}
        -- DISTINCT ON requires: same leading expression, then sal.id DESC to pick
        -- the latest SERIAL_ADDED SAL row as the representative for each tracking.
        ORDER BY COALESCE(tsn.shipment_id::text, COALESCE(tsn.scan_ref, '')), sal.id DESC
      ),
      fnsku_scan_rows AS (
        SELECT
          (-1 * sal.id)::bigint AS id,
          sal.id AS source_row_id,
          'fba_scan'::text AS source_kind,
          NULL::integer AS tech_serial_id,
          sal.created_at,
          sal.fnsku AS shipping_tracking_number,
          ''::text AS serial_number,
          sal.staff_id AS tested_by,
          sal.fba_shipment_id::bigint AS shipment_id,
          NULL::integer AS order_db_id,
          'FBA'::text AS order_id,
          NULL::timestamptz AS ship_by_date,
          NULL::text AS item_number,
          COALESCE(ff.product_title, sal.metadata->>'product_title') AS product_title,
          COALESCE(sal.metadata->>'quantity', '1') AS quantity,
          COALESCE(ff.condition, sal.metadata->>'condition', 'FBA Scan') AS condition,
          COALESCE(ff.sku, sal.metadata->>'sku') AS sku,
          sal.fnsku AS fnsku,
          COALESCE(fsi.status::text, fs.status::text, 'READY_TO_GO') AS status,
          '[]'::jsonb AS status_history,
          'fba'::text AS account_source,
          sal.notes,
          NULL::text AS out_of_stock,
          false AS is_shipped
        FROM station_activity_logs sal
        LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
        LEFT JOIN fba_shipment_items fsi ON fsi.id = sal.fba_shipment_item_id
        LEFT JOIN fba_shipments fs ON fs.id = sal.fba_shipment_id
        WHERE sal.station = 'TECH'
          AND sal.activity_type = 'FNSKU_SCANNED'
          AND sal.staff_id = $1
          ${weekClause}
          AND NOT EXISTS (
            SELECT 1
            FROM station_activity_logs sal2
            WHERE sal2.station = 'TECH'
              AND sal2.activity_type = 'SERIAL_ADDED'
              AND sal2.staff_id = sal.staff_id
              AND sal2.fnsku = sal.fnsku
          )
      )
      SELECT
        rows.id,
        rows.source_row_id,
        rows.source_kind,
        rows.tech_serial_id,
        rows.created_at,
        rows.shipping_tracking_number,
        rows.serial_number,
        rows.tested_by,
        rows.shipment_id,
        rows.order_db_id,
        rows.order_id,
        rows.ship_by_date,
        rows.item_number,
        rows.product_title,
        rows.quantity,
        rows.condition,
        rows.sku,
        rows.fnsku,
        rows.status,
        rows.status_history,
        rows.account_source,
        rows.notes,
        rows.out_of_stock,
        rows.is_shipped
      FROM (
        SELECT * FROM tracking_scan_rows
        UNION ALL
        SELECT * FROM serial_rows
        UNION ALL
        SELECT * FROM fnsku_scan_rows
      ) rows
      ORDER BY rows.created_at DESC NULLS LAST
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params,
    );

    if (isHistoricalWeek) {
      await setCachedJson('api:tech-logs', cacheLookup, result.rows, cacheTTL, ['tech-logs']);
    }
    return NextResponse.json(result.rows, { headers: { 'x-cache': 'MISS', ...cacheHeaders } });
  } catch (error: any) {
    console.error('Error fetching tech logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
  }
}
