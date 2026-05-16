import { NextRequest, NextResponse } from 'next/server';
import { renameRoom, softDeleteRoom } from '@/lib/neon/location-queries';

/**
 * PATCH /api/rooms/[room]
 * Body: { name: string }   — rename the room everywhere it appears.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ room: string }> },
) {
  const { room } = await params;
  const oldName = decodeURIComponent(room).trim();
  if (!oldName) {
    return NextResponse.json({ error: 'Current room name required' }, { status: 400 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const newName = String(body?.name ?? '').trim();
    if (!newName) {
      return NextResponse.json({ error: 'New name is required' }, { status: 400 });
    }
    if (newName === oldName) {
      return NextResponse.json({ success: true, updated: 0, barcodesRekeyed: 0 });
    }
    const result = await renameRoom(oldName, newName);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: 'A room with that name already exists' },
        { status: 409 },
      );
    }
    console.error('[PATCH /api/rooms/[room]] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}

/** DELETE /api/rooms/[room] — soft-delete the room + all its bins. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ room: string }> },
) {
  const { room } = await params;
  const name = decodeURIComponent(room).trim();
  if (!name) {
    return NextResponse.json({ error: 'Room name required' }, { status: 400 });
  }
  try {
    const result = await softDeleteRoom(name);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[DELETE /api/rooms/[room]] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}
