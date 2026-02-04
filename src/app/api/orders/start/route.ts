import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/start - Start an order (assign to technician if not already assigned)
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

    // Assign to tech if not already assigned
    await pool.query(
      `UPDATE orders 
       SET tester_id = COALESCE(tester_id, $2)
       WHERE id = $1`,
      [orderId, parseInt(techId)]
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
