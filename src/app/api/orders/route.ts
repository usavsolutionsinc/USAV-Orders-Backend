import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

/**
 * GET /api/orders - Fetch all pending orders with optional filters.
 * Assignment info (tester_id / packer_id) is sourced from work_assignments.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
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
    });

    const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' };

    const cached = await getCachedJson<any>('api:orders', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
    }

    // Lateral subqueries pull the latest assignment IDs for each order from work_assignments.
    // The alias columns (tester_id / packer_id) preserve backward-compat with client consumers.
    let sql = `
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
        o.customer_id,
        COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
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
      LEFT JOIN LATERAL (
        SELECT wa.deadline_at FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
        ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                 wa.updated_at DESC, wa.id DESC LIMIT 1
      ) wa_deadline ON TRUE
      LEFT JOIN LATERAL (
        SELECT assigned_tech_id
        FROM work_assignments
        WHERE entity_type = 'ORDER'
          AND entity_id   = o.id
          AND work_type   = 'TEST'
          AND assigned_tech_id IS NOT NULL
          AND status <> 'CANCELED'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      ) wa_t ON true
      LEFT JOIN LATERAL (
        SELECT assigned_packer_id
        FROM work_assignments
        WHERE entity_type = 'ORDER'
          AND entity_id   = o.id
          AND work_type   = 'PACK'
          AND assigned_packer_id IS NOT NULL
          AND status <> 'CANCELED'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      ) wa_p ON true
      LEFT JOIN LATERAL (
        SELECT pl.created_at AS packed_at, pl.packed_by
        FROM packer_logs pl
        WHERE pl.shipment_id IS NOT NULL
          AND pl.shipment_id = o.shipment_id
        ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC
        LIMIT 1
      ) pl_latest ON true
      LEFT JOIN LATERAL (
        SELECT sal.created_at, sal.staff_id
        FROM station_activity_logs sal
        WHERE sal.station = 'PACK'
          AND sal.shipment_id = o.shipment_id
          AND sal.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
        ORDER BY sal.created_at DESC NULLS LAST, sal.id DESC
        LIMIT 1
      ) pack_activity ON true
      LEFT JOIN LATERAL (
        SELECT sal.created_at
        FROM station_activity_logs sal
        WHERE sal.station = 'PACK'
          AND pack_activity.staff_id IS NOT NULL
          AND sal.staff_id = pack_activity.staff_id
          AND sal.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
          AND pack_activity.created_at IS NOT NULL
          AND sal.created_at > pack_activity.created_at
        ORDER BY sal.created_at ASC, sal.id ASC
        LIMIT 1
      ) next_pack_activity ON true
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      LEFT JOIN LATERAL (
        SELECT sal.created_at, sal.staff_id
        FROM station_activity_logs sal
        WHERE sal.station = 'TECH'
          AND sal.shipment_id = o.shipment_id
          AND sal.activity_type = 'TRACKING_SCANNED'
        ORDER BY sal.created_at DESC NULLS LAST, sal.id DESC
        LIMIT 1
      ) test_activity ON true
      LEFT JOIN LATERAL (
        SELECT sal.created_at
        FROM station_activity_logs sal
        WHERE sal.station = 'TECH'
          AND test_activity.staff_id IS NOT NULL
          AND sal.staff_id = test_activity.staff_id
          AND sal.activity_type = 'TRACKING_SCANNED'
          AND test_activity.created_at IS NOT NULL
          AND sal.created_at > test_activity.created_at
        ORDER BY sal.created_at ASC, sal.id ASC
        LIMIT 1
      ) next_test_activity ON true
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN MIN(sal.created_at) IS NOT NULL AND MAX(sal.created_at) > MIN(sal.created_at)
            THEN LPAD((EXTRACT(EPOCH FROM (MAX(sal.created_at) - MIN(sal.created_at)))::int / 60)::text, 2, '0')
                 || ':' ||
                 LPAD((EXTRACT(EPOCH FROM (MAX(sal.created_at) - MIN(sal.created_at)))::int % 60)::text, 2, '0')
            ELSE NULL
          END AS duration
        FROM station_activity_logs sal
        WHERE sal.station = 'PACK' AND sal.shipment_id = o.shipment_id
          AND sal.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
          AND (pack_activity.staff_id IS NULL OR sal.staff_id = pack_activity.staff_id)
      ) pack_duration ON true
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN MIN(sal.created_at) IS NOT NULL AND MAX(sal.created_at) > MIN(sal.created_at)
            THEN LPAD((EXTRACT(EPOCH FROM (MAX(sal.created_at) - MIN(sal.created_at)))::int / 60)::text, 2, '0')
                 || ':' ||
                 LPAD((EXTRACT(EPOCH FROM (MAX(sal.created_at) - MIN(sal.created_at)))::int % 60)::text, 2, '0')
            ELSE NULL
          END AS duration
        FROM station_activity_logs sal
        WHERE sal.station = 'TECH' AND sal.shipment_id = o.shipment_id
          AND sal.activity_type = 'TRACKING_SCANNED'
          AND (test_activity.staff_id IS NULL OR sal.staff_id = test_activity.staff_id)
      ) test_duration ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS scan_count
        FROM station_activity_logs sal
        WHERE sal.shipment_id = o.shipment_id
      ) sal_scan ON true
      LEFT JOIN staff staff_test_assignee ON staff_test_assignee.id = test_activity.staff_id
      LEFT JOIN staff staff_packed_by ON staff_packed_by.id = COALESCE(pack_activity.staff_id, pl_latest.packed_by)
      LEFT JOIN staff staff_pack_assignee ON staff_pack_assignee.id = wa_p.assigned_packer_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (shippedOnly) {
      sql += ` AND COALESCE(stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered, false)`;
    } else if (!includeShipped && !packedOnly) {
      // Pending/unshipped dashboards should stay limited to orders that have not
      // entered a carrier-shipped state, even when excludePacked is also active.
      sql += ` AND NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered, false)`;
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

    sql += ` ORDER BY wa_deadline.deadline_at ASC NULLS LAST, o.id ASC`;

    const result = await pool.query(sql, params);

    const payload = {
      orders:    result.rows,
      count:     result.rows.length,
      weekStart: weekStart || null,
      weekEnd:   weekEnd   || null,
    };
    await setCachedJson('api:orders', cacheLookup, payload, 300, ['orders']);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
  } catch (error: any) {
    console.error('Error in GET /api/orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: error.message },
      { status: 500 }
    );
  }
}
