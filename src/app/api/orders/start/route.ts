import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/start - DEPRECATED
 * 
 * This endpoint previously assigned orders to technicians via tester_id.
 * As of 2026-02-05, tester_id was removed from orders table.
 * 
 * Techs are now implicitly assigned when they scan a tracking number.
 * Assignment is tracked in tech_serial_numbers.tester_id.
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

    // No-op: Order assignment now happens when tech scans the tracking number
    console.log(`Order start requested for orderId=${orderId}, techId=${techId} - assignment now implicit via scanning`);

    return NextResponse.json({ 
      success: true,
      message: 'Order assignment now happens automatically when tech scans tracking number'
    });
  } catch (error: any) {
    console.error('Error in deprecated start endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to process request', details: error.message },
      { status: 500 }
    );
  }
}
