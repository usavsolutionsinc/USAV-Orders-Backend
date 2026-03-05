import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * GET /api/orders/next - Get next order(s) for a tech station.
 * "Assigned to this tech" means an active TEST work_assignment points to them.
 * "Unassigned" means no active TEST work_assignment exists for the order.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const techId     = searchParams.get('techId');
    const getAll     = searchParams.get('all') === 'true';
    const filterStatus = searchParams.get('status');
    const outOfStock = searchParams.get('outOfStock');
    const includeAllTechForOutOfStock = outOfStock === 'true';

    const cacheLookup = createCacheLookupKey({
      techId:     techId || '',
      all:        getAll,
      status:     filterStatus || '',
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

    // Orders assigned to this tech OR unassigned (no active TEST assignment at all)
    const techAssignedOrUnassigned = `(
      EXISTS (
        SELECT 1 FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.entity_id   = o.id
          AND wa.work_type   = 'TEST'
          AND wa.assigned_tech_id = ANY($1::int[])
          AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
      )
      OR NOT EXISTS (
        SELECT 1 FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.entity_id   = o.id
          AND wa.work_type   = 'TEST'
          AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
      )
    )`;

    // 1. Count total pending (assigned to this tech OR unassigned)
    const totalPendingResult = await pool.query(
      `SELECT COUNT(*) AS count
       FROM orders o
       WHERE (o.is_shipped = false OR o.is_shipped IS NULL)
         AND ${includeAllTechForOutOfStock ? 'TRUE' : techAssignedOrUnassigned}
         AND NOT EXISTS (
           SELECT 1 FROM tech_serial_numbers tsn
           WHERE RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
                 RIGHT(regexp_replace(COALESCE(o.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
         )`,
      includeAllTechForOutOfStock ? [] : [techIdScope]
    );
    const totalPending = parseInt(totalPendingResult.rows[0].count);

    // 2. Build main query
    const params: any[] = [];
    if (!includeAllTechForOutOfStock) {
      params.push(techIdScope); // $1
    }

    let query = `
      SELECT
        o.id,
        o.ship_by_date,
        o.created_at,
        o.order_id,
        o.product_title,
        o.item_number,
        o.sku,
        o.account_source,
        o.quantity,
        o.status,
        o.condition,
        o.shipping_tracking_number,
        o.out_of_stock
      FROM orders o
      WHERE
        (o.is_shipped = false OR o.is_shipped IS NULL)
        ${includeAllTechForOutOfStock ? '' : `AND ${techAssignedOrUnassigned}`}
        AND NOT EXISTS (
          SELECT 1 FROM tech_serial_numbers tsn
          WHERE RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
                RIGHT(regexp_replace(COALESCE(o.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
        )
    `;

    if (outOfStock === 'true') {
      query += ` AND o.out_of_stock IS NOT NULL AND o.out_of_stock != '' `;
    } else if (outOfStock === 'false') {
      query += ` AND (o.out_of_stock IS NULL OR o.out_of_stock = '') `;
    }

    if (filterStatus === 'missing_parts') {
      query += ` AND o.status = 'missing_parts' `;
    }

    query += `
      ORDER BY
        CASE
          WHEN o.ship_by_date IS NULL OR o.ship_by_date::text ~ '^\\d+$' THEN o.created_at
          ELSE o.ship_by_date
        END ASC
    `;

    if (!getAll) {
      query += ` LIMIT 1 `;
    }

    const result = await pool.query(query, params);

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
