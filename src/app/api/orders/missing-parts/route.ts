import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/missing-parts - Move order to missing parts status
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

    // Update order status to missing_parts and clear assignment
    await pool.query(
      'UPDATE orders SET status = $1, assigned_to = NULL WHERE id = $2',
      ['missing_parts', orderId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error marking order as missing parts:', error);
    return NextResponse.json(
      { error: 'Failed to update order', details: error.message },
      { status: 500 }
    );
  }
}
