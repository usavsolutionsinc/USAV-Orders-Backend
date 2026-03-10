import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * GET /api/orders/next - Get next order(s) for a tech.
 * Rules:
 *  - orders.shipping_tracking_number must be present
 *  - orders.is_shipped must be false/null
 *  - order must be assigned via work_assignments.assigned_tech_id (staff.id)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const techId     = searchParams.get('techId');
    const getAll     = searchParams.get('all') === 'true';
    const outOfStock = searchParams.get('outOfStock');
    const assignedOnly = searchParams.get('assignedOnly') === 'true';

    const cacheLookup = createCacheLookupKey({
      techId:     techId || '',
      all:        getAll,
      outOfStock: outOfStock || '',
      assignedOnly,
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
    const noTechScanClause = `
      NOT EXISTS (
        SELECT 1
        FROM tech_serial_numbers tsn
        WHERE RIGHT(regexp_replace(UPPER(COALESCE(tsn.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) =
              RIGHT(regexp_replace(UPPER(COALESCE(o.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
      )
    `;

    // 1. Count total pending orders for the requested scope.
    const countWhere: string[] = [
      "o.is_shipped IS NOT TRUE",
      "COALESCE(BTRIM(o.shipping_tracking_number), '') <> ''",
    ];
    const countJoins: string[] = [];
    if (assignedOnly) {
      countJoins.push(
        `INNER JOIN work_assignments wa
           ON wa.entity_id = o.id`,
        `INNER JOIN staff s
           ON s.id = wa.assigned_tech_id`
      );
      countWhere.unshift(
        "wa.entity_type = 'ORDER'",
        "wa.work_type = 'TEST'",
        "wa.assigned_tech_id = ANY($1::int[])"
      );
    }
    if (outOfStock === 'true') {
      countWhere.push("COALESCE(BTRIM(o.out_of_stock), '') <> ''");
    } else if (outOfStock === 'false') {
      countWhere.push("COALESCE(BTRIM(o.out_of_stock), '') = ''");
      countWhere.push(noTechScanClause);
    }

    const totalPendingResult = await pool.query(
      `SELECT COUNT(DISTINCT o.id) AS count
       FROM orders o
       ${countJoins.join('\n')}
       WHERE ${countWhere.join(' AND ')}`,
      assignedOnly ? [techIdScope] : []
    );
    const totalPending = parseInt(totalPendingResult.rows[0].count);

    // 2. Build main query
    const params: any[] = assignedOnly ? [techIdScope] : [];
    const where: string[] = [...countWhere];
    const mainJoins: string[] = [];
    if (assignedOnly) {
      mainJoins.push(
        `INNER JOIN work_assignments wa
          ON wa.entity_id = o.id`,
        `INNER JOIN staff s
          ON s.id = wa.assigned_tech_id`
      );
    }

    let query = `
      SELECT DISTINCT ON (o.id)
        o.id,
        o.ship_by_date,
        o.created_at,
        o.order_id,
        o.product_title,
        o.item_number,
        o.sku,
        o.account_source,
        o.quantity,
        o.condition,
        o.shipping_tracking_number,
        o.out_of_stock
      FROM orders o
      ${mainJoins.join('\n')}
      WHERE ${where.join(' AND ')}
    `;

    query += `
      ORDER BY
        o.id,
        ${assignedOnly ? 'wa.assigned_at DESC,' : ''}
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
