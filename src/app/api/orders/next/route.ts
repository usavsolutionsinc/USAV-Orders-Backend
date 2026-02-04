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

    const techIdNum = parseInt(techId);

    // 1. Check if there are ANY pending orders left for today (not completed, not missing_parts, not tested, not shipped)
    const totalPendingResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM orders o
       WHERE o.status NOT IN ('completed', 'missing_parts')
         AND (o.tester_id = $1 OR o.tester_id IS NULL)
         AND (o.test_date_time IS NULL OR o.test_date_time = '')
         AND (o.is_shipped = false OR o.is_shipped IS NULL)`,
      [techIdNum]
    );
    const totalPending = parseInt(totalPendingResult.rows[0].count);

    // 2. Build Query - Filter out orders already tested or shipped
    let query = `
      SELECT 
        id,
        ship_by_date,
        order_id,
        product_title,
        sku,
        status,
        condition,
        shipping_tracking_number,
        serial_number,
        out_of_stock
      FROM orders
      WHERE 
        -- Only show if not tested yet and not shipped
        (test_date_time IS NULL OR test_date_time = '')
        AND (is_shipped = false OR is_shipped IS NULL)
    `;
    const params: any[] = [techIdNum];
    let paramCount = 2;

    // Filter based on out_of_stock parameter
    if (outOfStock === 'true') {
      // Show orders where out_of_stock is NOT NULL and NOT empty
      query += ` AND out_of_stock IS NOT NULL AND out_of_stock != '' `;
    } else if (outOfStock === 'false') {
      // Show orders where out_of_stock is NULL or empty (current orders)
      query += ` AND (out_of_stock IS NULL OR out_of_stock = '') `;
    }

    if (filterStatus === 'missing_parts') {
      query += ` AND status = 'missing_parts' AND (tester_id = $1 OR tester_id IS NULL) `;
    } else {
      query += `
        -- Status is not completed or missing_parts
        AND status NOT IN ('completed', 'missing_parts')
        -- Either assigned to this tech OR truly unassigned
        AND (
          tester_id = $1 
          OR (tester_id IS NULL AND (status IS NULL OR status = 'unassigned'))
        )
      `;
    }

    query += `
      ORDER BY 
        ship_by_date ASC
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
