import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/orders - Fetch all orders with optional filters
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assignedTo');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        id,
        ship_by_date,
        order_id,
        product_title,
        quantity,
        sku,
        condition,
        shipping_tracking_number,
        days_late,
        out_of_stock,
        notes,
        assigned_to,
        status,
        urgent
      FROM orders
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      query += ` AND status = $${paramCount++}`;
      params.push(status);
    }

    if (assignedTo) {
      query += ` AND assigned_to = $${paramCount++}`;
      params.push(assignedTo);
    }

    query += ` ORDER BY urgent DESC, ship_by_date ASC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return NextResponse.json({
      orders: result.rows,
      page,
      limit,
      count: result.rows.length,
    });
  } catch (error: any) {
    console.error('Error in GET /api/orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: error.message },
      { status: 500 }
    );
  }
}
