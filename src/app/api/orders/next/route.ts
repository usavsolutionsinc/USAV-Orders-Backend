import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * GET /api/orders/next - Get next unassigned order(s) for technicians
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId');
    const getAll = searchParams.get('all') === 'true';
    const filterStatus = searchParams.get('status');
    const outOfStock = searchParams.get('outOfStock');
    const includeAllTechForOutOfStock = outOfStock === 'true';
    const cacheLookup = createCacheLookupKey({
      techId: techId || '',
      all: getAll,
      status: filterStatus || '',
      outOfStock: outOfStock || '',
    });

    const cached = await getCachedJson<any>('api:orders-next', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }

    if (!techId) {
      return NextResponse.json(
        { error: 'techId is required' },
        { status: 400 }
      );
    }

    const techIdNum = parseInt(techId, 10);
    if (!Number.isFinite(techIdNum)) {
      return NextResponse.json(
        { error: 'Invalid techId' },
        { status: 400 }
      );
    }

    // Resolve station techId (1/2/3/4) to actual staff.id when available.
    // Some environments store orders.tester_id as staff.id, others as station id.
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
    const testerIdScope = Array.from(
      new Set([techIdNum, resolvedStaffId].filter((v): v is number => Number.isFinite(v as number)))
    );

    // 1. Check if there are ANY pending orders left for this tech scope:
    //    assigned to this tech OR unassigned
    const totalPendingResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM orders o
       WHERE (o.is_shipped = false OR o.is_shipped IS NULL)
         AND (o.tester_id = ANY($1::int[]) OR COALESCE(o.tester_id::text, '') = '')
         AND NOT EXISTS (
           SELECT 1
           FROM tech_serial_numbers tsn
           WHERE RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
                 RIGHT(regexp_replace(COALESCE(o.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
         )`,
      [testerIdScope]
    );
    const totalPending = parseInt(totalPendingResult.rows[0].count);

    // 2. Build Query
    const params: any[] = [];
    const testerScopeFilter = includeAllTechForOutOfStock
      ? ''
      : `AND (tester_id = ANY($1::int[]) OR COALESCE(tester_id::text, '') = '')`;

    let query = `
      SELECT 
        id,
        ship_by_date,
        created_at,
        order_id,
        product_title,
        item_number,
        sku,
        account_source,
        quantity,
        status,
        condition,
        shipping_tracking_number,
        out_of_stock
      FROM orders
      WHERE 
        (is_shipped = false OR is_shipped IS NULL)
        ${testerScopeFilter}
        AND NOT EXISTS (
          SELECT 1
          FROM tech_serial_numbers tsn
          WHERE RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
                RIGHT(regexp_replace(COALESCE(orders.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
        )
    `;
    if (!includeAllTechForOutOfStock) {
      params.push(testerIdScope);
    }

    // Filter based on out_of_stock parameter
    if (outOfStock === 'true') {
      // Show orders where out_of_stock is NOT NULL and NOT empty
      query += ` AND out_of_stock IS NOT NULL AND out_of_stock != '' `;
    } else if (outOfStock === 'false') {
      // Show orders where out_of_stock is NULL or empty (current orders)
      query += ` AND (out_of_stock IS NULL OR out_of_stock = '') `;
    }

    // Note: tester_id assignment removed - techs can now work on any order
    // Filter by status if specified
    if (filterStatus === 'missing_parts') {
      query += ` AND status = 'missing_parts' `;
    }

    query += `
      ORDER BY 
        CASE
          WHEN ship_by_date IS NULL OR ship_by_date::text ~ '^\\d+$' THEN created_at
          ELSE ship_by_date
        END ASC
    `;

    if (!getAll) {
      query += ` LIMIT 1 `;
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      const payload = { 
        order: null, 
        orders: [],
        all_completed: totalPending === 0 
      };
      await setCachedJson('api:orders-next', cacheLookup, payload, 12, ['orders', 'orders-next']);
      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
    }

    if (getAll) {
      const payload = { 
        orders: result.rows,
        all_completed: false
      };
      await setCachedJson('api:orders-next', cacheLookup, payload, 12, ['orders', 'orders-next']);
      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
    }

    const payload = { 
      order: result.rows[0],
      all_completed: false
    };
    await setCachedJson('api:orders-next', cacheLookup, payload, 12, ['orders', 'orders-next']);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
  } catch (error: any) {
    console.error('Error fetching next order:', error);
    return NextResponse.json(
      { error: 'Failed to fetch next order', details: error.message },
      { status: 500 }
    );
  }
}
