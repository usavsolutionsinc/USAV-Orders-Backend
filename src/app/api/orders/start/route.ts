import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/start - Mark order as in-progress
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      );
    }

    // Update order status to in_progress
    await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      ['in_progress', orderId]
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
