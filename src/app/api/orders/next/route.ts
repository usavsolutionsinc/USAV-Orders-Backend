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

    // 1. Check if there are ANY pending orders left for today (not completed, not missing_parts, not assigned to someone else)
    const totalPendingResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM orders
       WHERE status NOT IN ('completed', 'missing_parts')
         AND (assigned_to = $1 OR assigned_to IS NULL OR assigned_to = '')`,
      [assignedTo]
    );
    const totalPending = parseInt(totalPendingResult.rows[0].count);

    // 2. Build Query
    let query = `
      SELECT 
        id,
        ship_by_date,
        order_id,
        product_title,
        sku,
        urgent,
        status,
        condition,
        shipping_tracking_number,
        out_of_stock
      FROM orders
      WHERE 
    `;
    const params: any[] = [assignedTo];
    let paramCount = 2;

    if (filterStatus === 'missing_parts') {
      query += ` status = 'missing_parts' AND (assigned_to = $1 OR assigned_to IS NULL OR assigned_to = '') `;
    } else {
      query += `
        -- Status is not completed or missing_parts
        status NOT IN ('completed', 'missing_parts')
        -- Out of stock must be empty for pending
        AND (out_of_stock IS NULL OR out_of_stock = '')
        -- Either assigned to this tech OR truly unassigned
        AND (
          assigned_to = $1 
          OR ((assigned_to IS NULL OR assigned_to = '') AND (status IS NULL OR status = 'unassigned'))
        )
      `;
    }

    query += `
      ORDER BY 
        urgent DESC,
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
