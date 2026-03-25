import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

let replenishmentSchemaCheck:
  | { value: boolean; checkedAt: number }
  | null = null;

function isDatabaseUnavailable(error: unknown) {
  if (!(error instanceof Error)) return false;
  const causeMessage = typeof (error as { cause?: unknown }).cause === 'object'
    ? String(((error as { cause?: { message?: string } }).cause?.message) || '')
    : '';
  const message = `${error.message} ${causeMessage}`;
  return /ENOTFOUND|ECONNREFUSED|connect_timeout|connection terminated|timeout/i.test(message);
}

async function hasReplenishmentSchema(): Promise<boolean> {
  if (replenishmentSchemaCheck && (Date.now() - replenishmentSchemaCheck.checkedAt) < 60_000) {
    return replenishmentSchemaCheck.value;
  }

  try {
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'replenishment_requests'
       ) AS present`
    );

    const value = Boolean(result.rows[0]?.present);
    replenishmentSchemaCheck = { value, checkedAt: Date.now() };
    return value;
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      replenishmentSchemaCheck = { value: false, checkedAt: Date.now() };
      return false;
    }
    throw error;
  }
}

/**
 * GET /api/orders - Fetch all pending orders with optional filters.
 * Assignment info (tester_id / packer_id) is sourced from work_assignments.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orderIdRaw       = searchParams.get('orderId');
    const orderIdFilter =
      orderIdRaw != null && /^\d+$/.test(orderIdRaw.trim())
        ? Number(orderIdRaw.trim())
        : NaN;
    const singleOrderMode = Number.isFinite(orderIdFilter) && orderIdFilter > 0;
    const status             = searchParams.get('status');
    const assignedTo         = searchParams.get('assignedTo');
    const query              = searchParams.get('q') || '';
    const weekStart          = searchParams.get('weekStart') || '';
    const weekEnd            = searchParams.get('weekEnd') || '';
    const assignmentStatus   = searchParams.get('assignmentStatus') || '';
    const shipByDate         = searchParams.get('shipByDate') || '';
    const packedBy           = searchParams.get('packedBy');
    const testedBy           = searchParams.get('testedBy');
    const includeShipped     = searchParams.get('includeShipped') === 'true';
    const shippedOnly        = searchParams.get('shippedOnly') === 'true';
    /** packedOnly=true  → only orders with a matching packer_logs row (packed & shipped view) */
    const packedOnly         = searchParams.get('packedOnly') === 'true';
    /** excludePacked=true → exclude orders that have a matching packer_logs row (pending view) */
    const excludePacked      = searchParams.get('excludePacked') === 'true';
    /** awaitingOnly=true → only orders without shipment_id (Awaiting tab: no tracking yet) */
    const awaitingOnly       = searchParams.get('awaitingOnly') === 'true';
    const shippedByCarrierOrLatestStatusSql = `COALESCE(
      stn.is_carrier_accepted
      OR stn.is_in_transit
      OR stn.is_out_for_delivery
      OR stn.is_delivered
      OR (
        COALESCE(BTRIM(stn.latest_status_category), '') <> ''
        AND UPPER(BTRIM(stn.latest_status_category)) NOT IN ('LABEL_CREATED', 'UNKNOWN')
      )
      OR UPPER(COALESCE(stn.latest_status_label, '')) LIKE '%MOVING THROUGH NETWORK%'
      OR UPPER(COALESCE(stn.latest_status_description, '')) LIKE '%MOVING THROUGH NETWORK%',
      false
    )`;

    const cacheLookup = createCacheLookupKey({
      status:             status || '',
      assignedTo:         assignedTo || '',
      query,
      weekStart,
      weekEnd,
      assignmentStatus,
      shipByDate,
      packedBy:           packedBy || '',
      testedBy:           testedBy || '',
      includeShipped,
      shippedOnly,
      packedOnly,
      excludePacked,
      awaitingOnly,
      shipmentStatusRuleVersion: 'latest_status_relaxed_v2',
    });

    const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' };

    if (!singleOrderMode) {
      const cached = await getCachedJson<any>('api:orders', cacheLookup);
      if (cached) {
        return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
      }
    }

    const hasReplenishment = await hasReplenishmentSchema();
    const replenishmentSelect = hasReplenishment
      ? `
        rr.id AS replenishment_request_id,
        rr.status AS replenishment_status,
        rr.quantity_to_order AS replenishment_quantity_to_order,
        rr.zoho_po_number AS replenishment_po_number,
        rr.notes AS replenishment_notes,`
      : `
        NULL::uuid AS replenishment_request_id,
        NULL::text AS replenishment_status,
        NULL::numeric AS replenishment_quantity_to_order,
        NULL::text AS replenishment_po_number,
        NULL::text AS replenishment_notes,`;
    // Precompute latest assignment and shipment activity in set-based CTEs so the
    // orders query does not fan out into multiple per-row lateral scans.
    let sql = `
      WITH wa_deadline_ranked AS (
        SELECT
          wa.entity_id,
          wa.deadline_at,
          ROW_NUMBER() OVER (
            PARTITION BY wa.entity_id
            ORDER BY
              CASE wa.status
                WHEN 'IN_PROGRESS' THEN 1
                WHEN 'ASSIGNED' THEN 2
                WHEN 'OPEN' THEN 3
                WHEN 'DONE' THEN 4
                ELSE 5
              END,
              wa.updated_at DESC,
              wa.id DESC
          ) AS rn
        FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.work_type = 'TEST'
      ),
      wa_deadline AS (
        SELECT entity_id, deadline_at
        FROM wa_deadline_ranked
        WHERE rn = 1
      ),
      wa_t_ranked AS (
        SELECT
          wa.entity_id,
          wa.assigned_tech_id,
          ROW_NUMBER() OVER (
            PARTITION BY wa.entity_id
            ORDER BY wa.updated_at DESC, wa.id DESC
          ) AS rn
        FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.work_type = 'TEST'
          AND wa.assigned_tech_id IS NOT NULL
          AND wa.status <> 'CANCELED'
      ),
      wa_t AS (
        SELECT entity_id, assigned_tech_id
        FROM wa_t_ranked
        WHERE rn = 1
      ),
      wa_p_ranked AS (
        SELECT
          wa.entity_id,
          wa.assigned_packer_id,
          ROW_NUMBER() OVER (
            PARTITION BY wa.entity_id
            ORDER BY wa.updated_at DESC, wa.id DESC
          ) AS rn
        FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.work_type = 'PACK'
          AND wa.assigned_packer_id IS NOT NULL
          AND wa.status <> 'CANCELED'
      ),
      wa_p AS (
        SELECT entity_id, assigned_packer_id
        FROM wa_p_ranked
        WHERE rn = 1
      ),
      pl_latest AS (
        SELECT DISTINCT ON (pl.shipment_id)
          pl.shipment_id,
          pl.created_at AS packed_at,
          pl.packed_by
        FROM packer_logs pl
        WHERE pl.shipment_id IS NOT NULL
        ORDER BY pl.shipment_id, pl.created_at DESC NULLS LAST, pl.id DESC
      ),
      pack_activity AS (
        SELECT DISTINCT ON (sal.shipment_id)
          sal.shipment_id,
          sal.created_at,
          sal.staff_id
        FROM station_activity_logs sal
        WHERE sal.station = 'PACK'
          AND sal.shipment_id IS NOT NULL
          AND sal.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
        ORDER BY sal.shipment_id, sal.created_at DESC NULLS LAST, sal.id DESC
      ),
      next_pack_activity AS (
        SELECT
          pa.shipment_id,
          MIN(sal.created_at) AS created_at
        FROM pack_activity pa
        JOIN station_activity_logs sal
          ON sal.shipment_id = pa.shipment_id
         AND sal.station = 'PACK'
         AND sal.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
         AND pa.staff_id IS NOT NULL
         AND sal.staff_id = pa.staff_id
         AND pa.created_at IS NOT NULL
         AND sal.created_at > pa.created_at
        GROUP BY pa.shipment_id
      ),
      test_activity AS (
        SELECT DISTINCT ON (sal.shipment_id)
          sal.shipment_id,
          sal.created_at,
          sal.staff_id
        FROM station_activity_logs sal
        WHERE sal.station = 'TECH'
          AND sal.shipment_id IS NOT NULL
          AND sal.activity_type = 'TRACKING_SCANNED'
        ORDER BY sal.shipment_id, sal.created_at DESC NULLS LAST, sal.id DESC
      ),
      next_test_activity AS (
        SELECT
          ta.shipment_id,
          MIN(sal.created_at) AS created_at
        FROM test_activity ta
        JOIN station_activity_logs sal
          ON sal.shipment_id = ta.shipment_id
         AND sal.station = 'TECH'
         AND sal.activity_type = 'TRACKING_SCANNED'
         AND ta.staff_id IS NOT NULL
         AND sal.staff_id = ta.staff_id
         AND ta.created_at IS NOT NULL
         AND sal.created_at > ta.created_at
        GROUP BY ta.shipment_id
      ),
      pack_duration AS (
        SELECT
          pa.shipment_id,
          CASE
            WHEN MIN(sal.created_at) IS NOT NULL AND MAX(sal.created_at) > MIN(sal.created_at)
            THEN LPAD((EXTRACT(EPOCH FROM (MAX(sal.created_at) - MIN(sal.created_at)))::int / 60)::text, 2, '0')
                 || ':' ||
                 LPAD((EXTRACT(EPOCH FROM (MAX(sal.created_at) - MIN(sal.created_at)))::int % 60)::text, 2, '0')
            ELSE NULL
          END AS duration
        FROM pack_activity pa
        JOIN station_activity_logs sal
          ON sal.shipment_id = pa.shipment_id
         AND sal.station = 'PACK'
         AND sal.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
         AND (pa.staff_id IS NULL OR sal.staff_id = pa.staff_id)
        GROUP BY pa.shipment_id
      ),
      test_duration AS (
        SELECT
          ta.shipment_id,
          CASE
            WHEN MIN(sal.created_at) IS NOT NULL AND MAX(sal.created_at) > MIN(sal.created_at)
            THEN LPAD((EXTRACT(EPOCH FROM (MAX(sal.created_at) - MIN(sal.created_at)))::int / 60)::text, 2, '0')
                 || ':' ||
                 LPAD((EXTRACT(EPOCH FROM (MAX(sal.created_at) - MIN(sal.created_at)))::int % 60)::text, 2, '0')
            ELSE NULL
          END AS duration
        FROM test_activity ta
        JOIN station_activity_logs sal
          ON sal.shipment_id = ta.shipment_id
         AND sal.station = 'TECH'
         AND sal.activity_type = 'TRACKING_SCANNED'
         AND (ta.staff_id IS NULL OR sal.staff_id = ta.staff_id)
        GROUP BY ta.shipment_id
      ),
      sal_scan AS (
        SELECT sal.shipment_id, COUNT(*)::int AS scan_count
        FROM station_activity_logs sal
        WHERE sal.shipment_id IS NOT NULL
        GROUP BY sal.shipment_id
      ),
      ${hasReplenishment ? `
      rr_ranked AS (
        SELECT
          rol.order_id,
          req.id,
          req.status,
          req.quantity_to_order,
          req.zoho_po_number,
          req.notes,
          ROW_NUMBER() OVER (
            PARTITION BY rol.order_id
            ORDER BY rol.created_at DESC, rol.id DESC
          ) AS rn
        FROM replenishment_order_lines rol
        JOIN replenishment_requests req ON req.id = rol.replenishment_request_id
      ),
      rr AS (
        SELECT
          order_id,
          id,
          status,
          quantity_to_order,
          zoho_po_number,
          notes
        FROM rr_ranked
        WHERE rn = 1
      )` : `
      rr AS (
        SELECT
          NULL::integer AS order_id,
          NULL::uuid AS id,
          NULL::text AS status,
          NULL::numeric AS quantity_to_order,
          NULL::text AS zoho_po_number,
          NULL::text AS notes
        WHERE false
      )`}
      SELECT
        o.id,
        wa_deadline.deadline_at AS deadline_at,
        to_char(wa_deadline.deadline_at, 'YYYY-MM-DD') AS ship_by_date,
        o.order_id,
        o.product_title,
        o.item_number,
        o.quantity,
        o.shipment_id,
        stn.tracking_number_raw AS tracking_number,
        o.sku,
        o.condition,
        o.out_of_stock,
        o.status,
        o.notes,
        ${replenishmentSelect}
        o.customer_id,
        stn.latest_status_code,
        stn.latest_status_label,
        stn.latest_status_description,
        stn.latest_status_category,
        ${shippedByCarrierOrLatestStatusSql} AS is_shipped,
        o.created_at,
        wa_t.assigned_tech_id   AS tester_id,
        wa_p.assigned_packer_id AS packer_id,
        pl_latest.packed_at,
        COALESCE(pack_activity.staff_id, pl_latest.packed_by) AS packed_by,
        to_char(pack_activity.created_at, 'YYYY-MM-DD HH24:MI:SS') AS pack_activity_at,
        to_char(next_pack_activity.created_at, 'YYYY-MM-DD HH24:MI:SS') AS next_pack_activity_at,
        pack_duration.duration AS pack_duration,
        test_activity.staff_id AS tested_by,
        to_char(test_activity.created_at, 'YYYY-MM-DD HH24:MI:SS') AS test_activity_at,
        to_char(next_test_activity.created_at, 'YYYY-MM-DD HH24:MI:SS') AS next_test_activity_at,
        test_duration.duration AS test_duration,
        ''::text AS serial_number,
        staff_test_assignee.name AS tester_name,
        staff_test_assignee.name AS tested_by_name,
        staff_pack_assignee.name AS packer_name,
        staff_packed_by.name     AS packed_by_name,
        (COALESCE(sal_scan.scan_count, 0) > 0) AS has_tech_scan
      FROM orders o
      LEFT JOIN wa_deadline ON wa_deadline.entity_id = o.id
      LEFT JOIN wa_t ON wa_t.entity_id = o.id
      LEFT JOIN wa_p ON wa_p.entity_id = o.id
      LEFT JOIN pl_latest ON pl_latest.shipment_id = o.shipment_id
      LEFT JOIN pack_activity ON pack_activity.shipment_id = o.shipment_id
      LEFT JOIN next_pack_activity ON next_pack_activity.shipment_id = o.shipment_id
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      LEFT JOIN rr ON rr.order_id = o.id
      LEFT JOIN test_activity ON test_activity.shipment_id = o.shipment_id
      LEFT JOIN next_test_activity ON next_test_activity.shipment_id = o.shipment_id
      LEFT JOIN pack_duration ON pack_duration.shipment_id = o.shipment_id
      LEFT JOIN test_duration ON test_duration.shipment_id = o.shipment_id
      LEFT JOIN sal_scan ON sal_scan.shipment_id = o.shipment_id
      LEFT JOIN staff staff_test_assignee ON staff_test_assignee.id = test_activity.staff_id
      LEFT JOIN staff staff_packed_by ON staff_packed_by.id = COALESCE(pack_activity.staff_id, pl_latest.packed_by)
      LEFT JOIN staff staff_pack_assignee ON staff_pack_assignee.id = wa_p.assigned_packer_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (shippedOnly) {
      sql += ` AND ${shippedByCarrierOrLatestStatusSql}`;
    } else if (!includeShipped && !packedOnly) {
      // Pending/unshipped dashboards should stay limited to orders that have not
      // entered a carrier-shipped state, even when excludePacked is also active.
      sql += ` AND NOT ${shippedByCarrierOrLatestStatusSql}`;
    }

    if (packedOnly) {
      sql += ` AND EXISTS (
        SELECT 1 FROM packer_logs pl
        WHERE pl.shipment_id IS NOT NULL AND pl.shipment_id = o.shipment_id
      )`;
    } else if (excludePacked) {
      sql += ` AND NOT EXISTS (
        SELECT 1 FROM packer_logs pl
        WHERE pl.shipment_id IS NOT NULL AND pl.shipment_id = o.shipment_id
      )`;
    }

    if (awaitingOnly) {
      sql += ` AND o.shipment_id IS NULL`;
    }

    if (status) {
      sql += ` AND o.status = $${paramCount++}`;
      params.push(status);
    }

    if (assignedTo) {
      // legacy: assignedTo maps to packer assignment
      sql += ` AND wa_p.assigned_packer_id = $${paramCount++}`;
      params.push(Number(assignedTo));
    }

    if (packedBy) {
      sql += ` AND wa_p.assigned_packer_id = $${paramCount++}`;
      params.push(Number(packedBy));
    }

    if (testedBy) {
      sql += ` AND wa_t.assigned_tech_id = $${paramCount++}`;
      params.push(Number(testedBy));
    }

    if (assignmentStatus === 'unassigned') {
      sql += `
        AND NOT EXISTS (
          SELECT 1 FROM work_assignments wa
          WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id
            AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
        )`;
    } else if (assignmentStatus === 'assigned') {
      sql += `
        AND EXISTS (
          SELECT 1 FROM work_assignments wa
          WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id
            AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
        )`;
    }

    if (shipByDate) {
      sql += ` AND COALESCE(wa_deadline.deadline_at::date, o.created_at::date) = $${paramCount++}`;
      params.push(shipByDate);
    } else {
      if (weekStart) {
        sql += ` AND COALESCE(wa_deadline.deadline_at::date, o.created_at::date) >= $${paramCount++}`;
        params.push(weekStart);
      }
      if (weekEnd) {
        sql += ` AND COALESCE(wa_deadline.deadline_at::date, o.created_at::date) <= $${paramCount++}`;
        params.push(weekEnd);
      }
    }

    const trimmedQuery = query.trim();
    const normalizedDigits = trimmedQuery.replace(/\D/g, '');
    const last8 = normalizedDigits.length >= 8 ? normalizedDigits.slice(-8) : '';
    const key18 = normalizeTrackingKey18(trimmedQuery);

    if (trimmedQuery) {
      const likeValue = `%${trimmedQuery}%`;
      sql += ` AND (
        o.product_title ILIKE $${paramCount}
        OR COALESCE(o.sku, '') ILIKE $${paramCount}
        OR COALESCE(o.order_id, '') ILIKE $${paramCount}
        OR COALESCE(o.item_number, '') ILIKE $${paramCount}
        OR COALESCE(stn.tracking_number_raw, '') ILIKE $${paramCount}
        OR COALESCE(o.status, '') ILIKE $${paramCount}
        OR COALESCE(o.notes, '') ILIKE $${paramCount}
        OR COALESCE(o.account_source, '') ILIKE $${paramCount}
        OR COALESCE(o.quantity, '') ILIKE $${paramCount}
        OR COALESCE(o.customer_id::text, '') ILIKE $${paramCount}
        OR o.id::text ILIKE $${paramCount}
      `;
      params.push(likeValue);
      paramCount++;

      if (last8) {
        sql += ` OR RIGHT(regexp_replace(COALESCE(o.order_id, ''), '[^0-9]', '', 'g'), 8) = $${paramCount}
          OR RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_normalized, '')), '[^A-Z0-9]', '', 'g'), 8) = $${paramCount}`;
        params.push(last8);
        paramCount++;
      }

      if (key18) {
        sql += ` OR o.shipment_id IN (
          SELECT s.id FROM shipping_tracking_numbers s
          WHERE RIGHT(regexp_replace(UPPER(COALESCE(s.tracking_number_normalized, '')), '[^A-Z0-9]', '', 'g'), 18) = $${paramCount}
        )`;
        params.push(key18);
        paramCount++;
      }

      if (/^\d+$/.test(trimmedQuery) && trimmedQuery.length <= 10) {
        sql += ` OR o.id = $${paramCount}
          OR COALESCE(o.customer_id, -1) = $${paramCount}`;
        params.push(Number(trimmedQuery));
        paramCount++;
      }

      sql += `)`;
    }

    if (singleOrderMode) {
      sql += ` AND o.id = $${paramCount++}`;
      params.push(orderIdFilter);
    }

    sql += ` ORDER BY wa_deadline.deadline_at ASC NULLS LAST, o.id ASC`;

    const result = await pool.query(sql, params);

    const payload = {
      orders:    result.rows,
      count:     result.rows.length,
      weekStart: weekStart || null,
      weekEnd:   weekEnd   || null,
    };
    if (!singleOrderMode) {
      await setCachedJson('api:orders', cacheLookup, payload, 300, ['orders']);
    }
    return NextResponse.json(payload, {
      headers: {
        'x-cache': singleOrderMode ? 'BYPASS' : 'MISS',
        ...CACHE_HEADERS,
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/orders:', error);
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json(
        { orders: [], count: 0, weekStart: null, weekEnd: null, dbUnavailable: true },
        { headers: { 'x-db-fallback': 'unavailable' } }
      );
    }
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: error.message },
      { status: 500 }
    );
  }
}
