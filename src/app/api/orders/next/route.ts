import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * GET /api/orders/next - Get next order(s) for a tech.
 * Rules:
 *  - orders.shipment_id must be set (linked to shipping_tracking_numbers)
 *  - order must NOT be carrier-accepted/in-transit/delivered
 *  - order must be assigned to this tech (wa.assigned_tech_id) OR have no active test assignment
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
      return NextResponse.json({ error: 'techId is required' }, { status: 400 });
    }

    const techIdNum = parseInt(techId, 10);
    if (!Number.isFinite(techIdNum)) {
      return NextResponse.json({ error: 'Invalid techId' }, { status: 400 });
    }

    // Resolve station number (1–4) to actual staff.id if applicable
    const techEmployeeIds: Record<string, string> = {
      '1': 'TECH001',
      '2': 'TECH002',
      '3': 'TECH003',
      '4': 'TECH004',
    };
    const employeeId = techEmployeeIds[techId];
    let resolvedStaffId: number | null = null;
    if (employeeId) {
      const staffResult = await pool.query(
        'SELECT id FROM staff WHERE employee_id = $1 LIMIT 1',
        [employeeId]
      );
      if (staffResult.rows.length > 0) {
        resolvedStaffId = Number(staffResult.rows[0].id);
      }
    }
    const techIdScope = Array.from(
      new Set([techIdNum, resolvedStaffId].filter((v): v is number => Number.isFinite(v as number)))
    );

    // $1 = techIdScope array — used for the assignment visibility filter throughout
    const noTechScanClause = `
      NOT EXISTS (
        SELECT 1
        FROM tech_serial_numbers tsn
        WHERE tsn.shipment_id IS NOT NULL
          AND tsn.shipment_id = o.shipment_id
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
          AND status IN ('ASSIGNED', 'IN_PROGRESS')
          AND completed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) wa_t ON true
      LEFT JOIN LATERAL (
        SELECT wa.deadline_at FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
          AND wa.completed_at IS NULL
          AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
        ORDER BY
          CASE wa.status
            WHEN 'IN_PROGRESS' THEN 1
            WHEN 'ASSIGNED'    THEN 2
            WHEN 'OPEN'        THEN 3
            ELSE 4
          END,
          wa.updated_at DESC, wa.id DESC
        LIMIT 1
      ) wa_deadline ON TRUE
      LEFT JOIN staff staff_t ON staff_t.id = wa_t.assigned_tech_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS scan_count
        FROM tech_serial_numbers tsn
        WHERE tsn.shipment_id IS NOT NULL
          AND tsn.shipment_id = o.shipment_id
      ) tsn_scan ON true
    `;

    // Base WHERE — applies to both count and main query.
    const baseConditions: string[] = [
      `NOT EXISTS (
        SELECT 1
        FROM work_assignments wa_done
        WHERE wa_done.entity_type = 'ORDER'
          AND wa_done.entity_id = o.id
          AND wa_done.work_type IN ('TEST', 'PACK')
          AND (
            wa_done.status = 'DONE'
            OR wa_done.completed_at IS NOT NULL
          )
      )`,
    ];

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

    const totalPendingResult = await pool.query(
      `SELECT COUNT(DISTINCT o.id) AS count
       FROM orders o
       ${sharedJoins}
       WHERE ${countConditions.join(' AND ')}`,
      queryParams,
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
        (COALESCE(tsn_scan.scan_count, 0) > 0) AS has_tech_scan
      FROM orders o
      ${sharedJoins}
      WHERE ${mainConditions.join(' AND ')}
      ORDER BY
        o.id,
        COALESCE(wa_deadline.deadline_at, o.created_at) ASC
      ${!getAll ? 'LIMIT 1' : ''}
    `;

    const result = await pool.query(mainQuery, queryParams);

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
    console.error('Error fetching next order:', error);
    return NextResponse.json(
      { error: 'Failed to fetch next order', details: error.message },
      { status: 500 }
    );
  }
}
