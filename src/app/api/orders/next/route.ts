import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/orders/next - Get next assigned order for a technician
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

    // Get next assigned order ordered by urgent first, then by ship_by_date
    const result = await pool.query(
      `SELECT 
        id,
        ship_by_date,
        order_id,
        product_title,
        sku,
        urgent,
        status
      FROM orders
      WHERE assigned_to = $1 
        AND status = 'assigned'
      ORDER BY 
        urgent DESC,
        ship_by_date ASC
      LIMIT 1`,
      [assignedTo]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ order: null });
    }

    return NextResponse.json({ order: result.rows[0] });
  } catch (error: any) {
    console.error('Error fetching next order:', error);
    return NextResponse.json(
      { error: 'Failed to fetch next order', details: error.message },
      { status: 500 }
    );
  }
}
