import { NextRequest, NextResponse } from 'next/server';
import { createLocation, getRooms } from '@/lib/neon/location-queries';

/** GET /api/rooms — list active rooms (parent rows with no row/col). */
export async function GET() {
  try {
    const rooms = await getRooms();
    return NextResponse.json({ rooms });
  } catch (err: any) {
    console.error('[GET /api/rooms] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}

/**
 * POST /api/rooms
 * Body: { name: string, description?: string, sortOrder?: number }
 * Creates a room-level location entry (no row/col).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }
    const room = await createLocation({
      name,
      room: name,
      description: body?.description?.trim() || null,
      sortOrder: typeof body?.sortOrder === 'number' ? body.sortOrder : 0,
    });
    return NextResponse.json({ success: true, room }, { status: 201 });
  } catch (err: any) {
    if (err?.code === '23505' || /unique/i.test(err?.message || '')) {
      return NextResponse.json({ error: 'Room already exists' }, { status: 409 });
    }
    console.error('[POST /api/rooms] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}
