import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/orders/skip - Skip an order for a technician
 * NOTE: skipped_by column was removed from DB, so this is currently a no-op
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

    // skipped_by column was removed from DB, so we just return success
    return NextResponse.json({ success: true, message: 'Skip acknowledged (feature disabled)' });
  } catch (error: any) {
    console.error('Error skipping order:', error);
    return NextResponse.json(
      { error: 'Failed to skip order', details: error.message },
      { status: 500 }
    );
  }
}
