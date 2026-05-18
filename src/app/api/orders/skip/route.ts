import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * POST /api/orders/skip - Skip an order for a technician
 * NOTE: skipped_by column was removed from DB, so this is currently a no-op
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

    // skipped_by column was removed from DB, so we just return success
    return NextResponse.json({ success: true, message: 'Skip acknowledged (feature disabled)' });
  } catch (error: any) {
    console.error('Error skipping order:', error);
    return NextResponse.json(
      { error: 'Failed to skip order', details: error.message },
      { status: 500 }
    );
  }
}, { permission: 'tech.scan_serial' });
