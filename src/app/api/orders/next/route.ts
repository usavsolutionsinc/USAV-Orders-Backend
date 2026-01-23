import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/orders/next - Get next order for a technician (assigned or unassigned)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId');

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

    // 2. Get the next order that:
    // - Is assigned to this tech OR is unassigned
    // - Is NOT completed or in_progress (unless assigned to this tech)
    // - Has NOT been skipped by this tech
    const result = await pool.query(
      `SELECT 
        id,
        ship_by_date,
        order_id,
        product_title,
        sku,
        urgent,
        status,
        condition
      FROM orders
      WHERE 
        -- Status is not completed or missing_parts
        status NOT IN ('completed', 'missing_parts')
        -- Either assigned to this tech OR truly unassigned
        AND (
          assigned_to = $1 
          OR ((assigned_to IS NULL OR assigned_to = '') AND (status IS NULL OR status = 'unassigned'))
        )
        -- Not skipped by this tech
        AND (
          skipped_by IS NULL 
          OR skipped_by = '' 
          OR NOT (skipped_by::jsonb ? $2)
        )
      ORDER BY 
        urgent DESC,
        ship_by_date ASC
      LIMIT 1`,
      [assignedTo, techId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ 
        order: null, 
        all_completed: totalPending === 0 
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
