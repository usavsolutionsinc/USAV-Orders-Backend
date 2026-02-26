import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

/**
 * POST /api/orders/delete - Delete one or more orders
 * Body: { orderId?: number, orderIds?: number[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, orderIds } = body;

    if (!orderId && (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0)) {
      return NextResponse.json(
        { error: 'orderId or orderIds array is required' },
        { status: 400 }
      );
    }

    const idsToDelete: number[] = orderId ? [orderId] : orderIds;
    const placeholders = idsToDelete.map((_, idx) => `$${idx + 1}`).join(', ');

    const result = await pool.query(
      `DELETE FROM orders WHERE id IN (${placeholders})`,
      idsToDelete
    );

    await invalidateCacheTags(['orders', 'shipped']);
    return NextResponse.json({ success: true, deleted: result.rowCount || 0 });
  } catch (error: any) {
    console.error('Error deleting order(s):', error);
    return NextResponse.json(
      { error: 'Failed to delete order(s)', details: error.message },
      { status: 500 }
    );
  }
}
