import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * POST /api/orders/start - DEPRECATED
 * 
 * This endpoint previously assigned orders to technicians via tester_id.
 * As of 2026-02-05, tester_id was removed from orders table.
 * 
 * Techs are now implicitly assigned when they scan a tracking number.
 * Assignment is tracked in tech_serial_numbers.tested_by.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { orderId } = await req.json();
    const techId = ctx.staffId;

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
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
}, { permission: 'tech.scan_serial' });
