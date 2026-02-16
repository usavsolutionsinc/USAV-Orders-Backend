import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/orders/next - Get next order for a technician (assigned or unassigned)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId');
    const getAll = searchParams.get('all') === 'true';
    const filterStatus = searchParams.get('status');
    const outOfStock = searchParams.get('outOfStock');

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

    // 1. Check if there are ANY pending orders left for today (not completed, not shipped)
    // Note: tester_id removed - now checking all unshipped orders
    const totalPendingResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM orders o
       WHERE (o.is_shipped = false OR o.is_shipped IS NULL)
         AND o.tester_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM tech_serial_numbers tsn
           WHERE RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
                 RIGHT(regexp_replace(COALESCE(o.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
         )`,
      [techIdNum]
    );
    const totalPending = parseInt(totalPendingResult.rows[0].count);

    // 2. Build Query
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
        AND tester_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM tech_serial_numbers tsn
          WHERE RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
                RIGHT(regexp_replace(COALESCE(orders.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
        )
    `;
    const params: any[] = [techIdNum];

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
      return NextResponse.json({ 
        order: null, 
        orders: [],
        all_completed: totalPending === 0 
      });
    }

    if (getAll) {
      return NextResponse.json({ 
        orders: result.rows,
        all_completed: false
      });
    }

    return NextResponse.json({ 
      order: result.rows[0],
      all_completed: false
    });
  } catch (error: any) {
    console.error('Error fetching next order:', error);
    return NextResponse.json(
      { error: 'Failed to fetch next order', details: error.message },
      { status: 500 }
    );
  }
}
