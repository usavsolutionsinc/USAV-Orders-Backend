import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';
import { parsePositiveInt } from '@/utils/number';
import { TECH_EMPLOYEE_IDS } from '@/utils/staff';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';

/**
 * GET /api/orders/next - Get next order(s) for a tech.
 * Rules:
 *  - orders.shipment_id must be set (linked to shipping_tracking_numbers)
 *  - order must NOT be carrier-accepted/in-transit/delivered
 *  - order must be assigned to this tech (wa.assigned_tech_id) OR have no test assignment
 *    (unassigned orders are visible to all techs)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const techId     = searchParams.get('techId');
    const getAll     = searchParams.get('all') === 'true';
    const outOfStock = searchParams.get('outOfStock');

    const cacheLookup = createCacheLookupKey({
      techId:     techId || '',
      all:        getAll,
      outOfStock: outOfStock || '',
    });

    const cached = await getCachedJson<any>('api:orders-next', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }

    if (!techId) {
      console.warn('[orders/next] called without techId');
      return NextResponse.json({ orders: [], order: null, all_completed: false });
    }

    const techIdNum = parsePositiveInt(techId);
    if (techIdNum === null) {
      console.warn('[orders/next] invalid techId:', techId);
      return NextResponse.json({ orders: [], order: null, all_completed: false });
    }

    // Resolve station number (1–4) to actual staff.id if applicable
    const employeeId = TECH_EMPLOYEE_IDS[techId];
    let resolvedStaffId: number | null = null;
    if (employeeId) {
      const staffResult = await queryWithRetry(
        () => pool.query('SELECT id FROM staff WHERE employee_id = $1 LIMIT 1', [employeeId]),
        { retries: 3, delayMs: 1000 },
      );
      if (staffResult.rows.length > 0) {
        resolvedStaffId = Number(staffResult.rows[0].id);
      }
    }
    const techIdScope = Array.from(
      new Set([techIdNum, resolvedStaffId].filter((v): v is number => Number.isFinite(v as number)))
    );

    // $1 = techIdScope array — used for the assignment visibility filter throughout
    // Hide from up-next when any station_activity_log is tied to this shipment, OR when
    // a TECH scan row matches the order's tracking via scan_ref (same idea as /api/tech-logs
    // order_match) — otherwise SAL rows with NULL shipment_id still show in TechTable but
    // would not match `sal.shipment_id = o.shipment_id`.
    const techSalTrackingMatch = `
      sal.station = 'TECH'
      AND sal.activity_type IN ('TRACKING_SCANNED', 'SERIAL_ADDED', 'FNSKU_SCANNED')
      AND stn.id IS NOT NULL
      AND stn.tracking_number_raw IS NOT NULL
      AND BTRIM(stn.tracking_number_raw) <> ''
      AND COALESCE(sal.scan_ref, sal_stn.tracking_number_raw, '') <> ''
      AND BTRIM(COALESCE(sal.scan_ref, sal_stn.tracking_number_raw, '')) <> ''
      AND RIGHT(regexp_replace(UPPER(stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
          RIGHT(regexp_replace(UPPER(COALESCE(sal.scan_ref, sal_stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18)
    `;
    const noTechScanClause = `
      NOT EXISTS (
        SELECT 1
        FROM station_activity_logs sal
        LEFT JOIN shipping_tracking_numbers sal_stn ON sal_stn.id = sal.shipment_id
        WHERE (
          sal.shipment_id IS NOT NULL
          AND sal.shipment_id = o.shipment_id
        )
        OR (
          ${techSalTrackingMatch}
        )
      )
    `;

    // Joins shared by both the count query and the main query
    const sharedJoins = `
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
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
        SELECT wa.deadline_at FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
          AND wa.status <> 'CANCELED'
        ORDER BY
          CASE wa.status
            WHEN 'IN_PROGRESS' THEN 1
            WHEN 'ASSIGNED'    THEN 2
            WHEN 'OPEN'        THEN 3
            WHEN 'DONE'        THEN 4
            ELSE 5
          END,
          wa.updated_at DESC, wa.id DESC
        LIMIT 1
      ) wa_deadline ON TRUE
      LEFT JOIN staff staff_t ON staff_t.id = wa_t.assigned_tech_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS scan_count
        FROM station_activity_logs sal
        LEFT JOIN shipping_tracking_numbers sal_stn ON sal_stn.id = sal.shipment_id
        WHERE (
          sal.shipment_id IS NOT NULL
          AND sal.shipment_id = o.shipment_id
        )
        OR (
          ${techSalTrackingMatch}
        )
      ) sal_scan ON true
    `;

    // Base WHERE — applies to both count and main query.
    const baseConditions: string[] = [];

    const countConditions = [...baseConditions];
    if (outOfStock === 'true') {
      countConditions.push(`COALESCE(BTRIM(o.out_of_stock), '') <> ''`);
      // Stock blockers are globally visible to all techs regardless of assignment.
    } else if (outOfStock === 'false') {
      countConditions.push(`NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
         OR stn.is_out_for_delivery OR stn.is_delivered, false)`);
      countConditions.push(`o.shipment_id IS NOT NULL`);
      countConditions.push(`COALESCE(BTRIM(o.out_of_stock), '') = ''`);
      countConditions.push(noTechScanClause);
      // Normal order flow: show orders assigned to this tech or currently unassigned.
      countConditions.push(`(wa_t.assigned_tech_id IS NULL OR wa_t.assigned_tech_id = ANY($1::int[]))`);
    }

    const queryParams = outOfStock === 'false' ? [techIdScope] : [];

    const totalPendingResult = await queryWithRetry(
      () => pool.query(
        `SELECT COUNT(DISTINCT o.id) AS count
         FROM orders o
         ${sharedJoins}
         WHERE ${countConditions.join(' AND ')}`,
        queryParams,
      ),
      { retries: 3, delayMs: 1000 },
    );
    const totalPending = parseInt(totalPendingResult.rows[0].count);

    const mainConditions = [...countConditions];

    const mainQuery = `
      SELECT DISTINCT ON (o.id)
        o.id,
        o.shipment_id,
        to_char(wa_deadline.deadline_at, 'YYYY-MM-DD') AS ship_by_date,
        o.created_at,
        o.order_id,
        o.product_title,
        o.item_number,
        o.sku,
        o.account_source,
        o.quantity,
        o.condition,
        stn.tracking_number_raw AS shipping_tracking_number,
        COALESCE(
          stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered,
          false
        ) AS is_shipped,
        o.out_of_stock,
        wa_t.assigned_tech_id AS tester_id,
        staff_t.name          AS tester_name,
        (COALESCE(sal_scan.scan_count, 0) > 0) AS has_tech_scan
      FROM orders o
      ${sharedJoins}
      WHERE ${mainConditions.join(' AND ')}
      ORDER BY
        o.id,
        COALESCE(wa_deadline.deadline_at, o.created_at) ASC
      ${!getAll ? 'LIMIT 1' : ''}
    `;

    const result = await queryWithRetry(
      () => pool.query(mainQuery, queryParams),
      { retries: 3, delayMs: 1000 },
    );

    if (result.rows.length === 0) {
      const payload = { order: null, orders: [], all_completed: totalPending === 0 };
      await setCachedJson('api:orders-next', cacheLookup, payload, 120, ['orders', 'orders-next']);
      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
    }

    if (getAll) {
      const payload = { orders: result.rows, all_completed: false };
      await setCachedJson('api:orders-next', cacheLookup, payload, 120, ['orders', 'orders-next']);
      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
    }

    const payload = { order: result.rows[0], all_completed: false };
    await setCachedJson('api:orders-next', cacheLookup, payload, 120, ['orders', 'orders-next']);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
  } catch (error: any) {
    if (isTransientDbError(error)) {
      const getAll = req.nextUrl.searchParams.get('all') === 'true';
      const payload = getAll
        ? { orders: [], all_completed: false, fallback: 'db_unavailable' }
        : { order: null, all_completed: false, fallback: 'db_unavailable' };
      return NextResponse.json(payload, { headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error fetching next order:', error);
    return NextResponse.json(
      { error: 'Failed to fetch next order', details: error.message },
      { status: 500 }
    );
  }
}
