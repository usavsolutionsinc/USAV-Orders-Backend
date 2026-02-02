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

    if (!techId) {
      return NextResponse.json(
        { error: 'techId is required' },
        { status: 400 }
      );
    }

    const assignedTo = `Tech_${techId}`;

    // 1. Check if there are ANY pending orders left for today (not completed, not missing_parts, not tested, not assigned to someone else)
    const totalPendingResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM orders o
       LEFT JOIN shipped s ON RIGHT(o.shipping_tracking_number, 8) = RIGHT(s.shipping_tracking_number, 8)
       WHERE o.status NOT IN ('completed', 'missing_parts')
         AND (o.assigned_to = $1 OR o.assigned_to IS NULL OR o.assigned_to = '')
         AND NOT (s.tested_by IS NOT NULL AND s.tested_by != '' AND s.test_date_time IS NOT NULL AND s.test_date_time != '')`,
      [assignedTo]
    );
    const totalPending = parseInt(totalPendingResult.rows[0].count);

    // 2. Build Query - Filter out orders already tested (checked via shipped.tested_by AND test_date_time)
    let query = `
      SELECT 
        o.id,
        o.ship_by_date,
        o.order_id,
        o.product_title,
        o.sku,
        o.urgent,
        o.status,
        o.condition,
        o.shipping_tracking_number,
        o.out_of_stock
      FROM orders o
      LEFT JOIN shipped s ON RIGHT(o.shipping_tracking_number, 8) = RIGHT(s.shipping_tracking_number, 8)
      WHERE 
        -- Exclude orders that have been tested (BOTH tested_by AND test_date_time must be filled to exclude)
        NOT (s.tested_by IS NOT NULL AND s.tested_by != '' AND s.test_date_time IS NOT NULL AND s.test_date_time != '')
    `;
    const params: any[] = [assignedTo];
    let paramCount = 2;

    if (filterStatus === 'missing_parts') {
      query += ` AND o.status = 'missing_parts' AND (o.assigned_to = $1 OR o.assigned_to IS NULL OR o.assigned_to = '') `;
    } else {
      query += `
        -- Status is not completed or missing_parts
        AND o.status NOT IN ('completed', 'missing_parts')
        -- Out of stock must be empty for pending
        AND (o.out_of_stock IS NULL OR o.out_of_stock = '')
        -- Either assigned to this tech OR truly unassigned
        AND (
          o.assigned_to = $1 
          OR ((o.assigned_to IS NULL OR o.assigned_to = '') AND (o.status IS NULL OR o.status = 'unassigned'))
        )
      `;
    }

    query += `
      ORDER BY 
        o.urgent DESC,
        o.ship_by_date ASC
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
