import { NextRequest, NextResponse } from 'next/server';
import { createLocation, getRooms, setRoomZoneLetter } from '@/lib/neon/location-queries';
import { withAuth } from '@/lib/auth/withAuth';

/** GET /api/rooms — list active rooms (parent rows with no row/col). */
export const GET = withAuth(async (_req, ctx) => {
  try {
    // Tenant-scoped read: getRooms threads organization_id into the SELECT
    // (locations is tenant-owned) and runs through tenantQuery so the GUC is set.
    const rooms = await getRooms(ctx.organizationId);
    return NextResponse.json({ rooms });
  } catch (err: any) {
    console.error('[GET /api/rooms] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}, { permission: 'sku_stock.view' });

/**
 * POST /api/rooms
 * Body: { name: string, description?: string, sortOrder?: number }
 * Creates a room-level location entry (no row/col).
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }
    const zoneLetter =
      typeof body?.zoneLetter === 'string' ? body.zoneLetter : null;
    try {
      // Tenant-scoped write: createLocation stamps organization_id on the
      // INSERT and runs inside withTenantTransaction when an orgId is threaded.
      const room = await createLocation({
        name,
        room: name,
        description: body?.description?.trim() || null,
        sortOrder: typeof body?.sortOrder === 'number' ? body.sortOrder : 0,
        zoneLetter,
      }, ctx.organizationId);
      return NextResponse.json({ success: true, room }, { status: 201 });
    } catch (err: any) {
      // Duplicate zone_letter — partial unique index violation.
      if (err?.code === '23505' && /zone_letter/.test(err?.message ?? '')) {
        return NextResponse.json(
          { error: 'Another room is already using that zone letter' },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err: any) {
    if (err?.code === '23505' || /unique/i.test(err?.message || '')) {
      return NextResponse.json({ error: 'Room already exists' }, { status: 409 });
    }
    console.error('[POST /api/rooms] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}, { permission: 'sku_stock.manage' });
