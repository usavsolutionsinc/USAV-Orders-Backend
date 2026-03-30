import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

/**
 * POST /api/orders/set-item-number
 * Updates the item_number on a specific orders row (by DB id).
 * Used by the manual assignment form when an order was created without an item number.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    const itemNumber = String(body?.item_number || body?.itemNumber || '').trim().toUpperCase();

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid order id is required' }, { status: 400 });
    }
    if (!itemNumber) {
      return NextResponse.json({ success: false, error: 'item_number is required' }, { status: 400 });
    }

    const result = await pool.query(
      `UPDATE orders
       SET item_number = $1
       WHERE id = $2
         AND (item_number IS NULL OR item_number = '')
       RETURNING id, order_id, item_number`,
      [itemNumber, id]
    );

    if (result.rowCount === 0) {
      // Row not found or item_number already set — treat as success
      return NextResponse.json({ success: true, updated: false, message: 'item_number already set or row not found' });
    }

    await invalidateCacheTags(['orders']);
    await publishOrderChanged({ orderIds: [id], source: 'orders.set-item-number' });

    return NextResponse.json({ success: true, updated: true, row: result.rows[0] });
  } catch (error: any) {
    console.error('[set-item-number] error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}
