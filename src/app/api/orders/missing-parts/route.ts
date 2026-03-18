import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { clearReplenishmentForOrder, ensureReplenishmentForOrder } from '@/lib/replenishment';

/**
 * POST /api/orders/missing-parts - Move order to missing parts status
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, reason } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      );
    }

    // Update order to mark missing parts and set reason
    await pool.query(
      'UPDATE orders SET out_of_stock = $1 WHERE id = $2',
      [reason || null, orderId]
    );

    if (process.env.FEATURE_REPLENISHMENT === 'true') {
      const trimmedReason = String(reason || '').trim();
      if (trimmedReason) {
        await ensureReplenishmentForOrder({
          orderId: Number(orderId),
          reason: trimmedReason,
          changedBy: 'staff',
          forceFullQuantity: true,
        });
      } else {
        await clearReplenishmentForOrder(Number(orderId), 'staff');
      }
    }

    await invalidateCacheTags(['orders', 'shipped', 'need-to-order']);
    await publishOrderChanged({ orderIds: [Number(orderId)], source: 'orders.missing-parts' });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error marking order as missing parts:', error);
    return NextResponse.json(
      { error: 'Failed to update order', details: error.message },
      { status: 500 }
    );
  }
}
