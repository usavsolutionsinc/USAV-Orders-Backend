import { NextRequest, NextResponse } from 'next/server';
import { reorderRooms } from '@/lib/neon/location-queries';

/**
 * POST /api/rooms/reorder
 * Body: { order: string[] }   — room names, in the new display order.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const order = Array.isArray(body?.order) ? body.order.map(String) : null;
    if (!order || order.length === 0) {
      return NextResponse.json({ error: 'order array required' }, { status: 400 });
    }
    if (order.length > 200) {
      return NextResponse.json({ error: 'Too many rooms (max 200)' }, { status: 400 });
    }
    const result = await reorderRooms(order);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[POST /api/rooms/reorder] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}
