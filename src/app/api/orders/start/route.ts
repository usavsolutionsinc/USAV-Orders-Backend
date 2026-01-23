import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/start - Start an order (assign if unassigned)
 */
export async function POST(req: NextRequest) {
  try {
    const { orderId, techId } = await req.json();

    if (!orderId || !techId) {
      return NextResponse.json(
        { error: 'orderId and techId are required' },
        { status: 400 }
      );
    }

    const assignedTo = `Tech_${techId}`;

    // Update status to in_progress and assign to tech if not already assigned
    await pool.query(
      `UPDATE orders 
       SET status = 'in_progress',
           assigned_to = COALESCE(assigned_to, $2)
       WHERE id = $1`,
      [orderId, assignedTo]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error starting order:', error);
    return NextResponse.json(
      { error: 'Failed to start order', details: error.message },
      { status: 500 }
    );
  }
}
