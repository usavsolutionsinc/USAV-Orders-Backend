import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  getActiveLocations,
  getRooms,
  createLocation,
  getLowStockBins,
} from '@/lib/neon/location-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import type { AnonymousAuthContext } from '@/lib/auth/withAuth';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

async function resolveCtx(req: NextRequest): Promise<AnonymousAuthContext> {
  const noopMark = () => {};
  const sid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getCurrentUserBySid(sid);
  return user
    ? { user, session: user.session, staffId: user.staffId, organizationId: user.organizationId, role: user.role, permissions: user.permissions, markAuditWritten: noopMark }
    : { user: null, session: null, staffId: null, organizationId: null, role: null, permissions: new Set(), markAuditWritten: noopMark };
}

/** GET /api/locations — list active locations. ?type=zones for zone-only, ?type=low-stock for alerts */
export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get('type');

    if (type === 'rooms') {
      const rooms = await getRooms();
      return NextResponse.json({ locations: rooms });
    }

    if (type === 'low-stock') {
      const bins = await getLowStockBins();
      return NextResponse.json({ bins });
    }

    const locations = await getActiveLocations();

    // Build room → rows → cols structure for cascading picker
    const roomMap: Record<string, { rows: Record<string, string[]> }> = {};
    for (const loc of locations) {
      if (!loc.room || !loc.row_label || !loc.col_label) continue;
      if (!roomMap[loc.room]) roomMap[loc.room] = { rows: {} };
      if (!roomMap[loc.room].rows[loc.row_label]) roomMap[loc.room].rows[loc.row_label] = [];
      if (!roomMap[loc.room].rows[loc.row_label].includes(loc.col_label)) {
        roomMap[loc.room].rows[loc.row_label].push(loc.col_label);
      }
    }

    return NextResponse.json({ locations, roomStructure: roomMap });
  } catch (err: any) {
    console.error('[GET /api/locations] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch locations', details: err?.message },
      { status: 500 },
    );
  }
}

/** POST /api/locations — create a new location */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, room, description, barcode, sortOrder, rowLabel, colLabel, binType, capacity, parentId } = body as {
      name?: string;
      room?: string;
      description?: string;
      barcode?: string;
      sortOrder?: number;
      rowLabel?: string;
      colLabel?: string;
      binType?: string;
      capacity?: number;
      parentId?: number;
    };

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const location = await createLocation({
      name: name.trim(),
      room: room?.trim() || null,
      description: description?.trim() || null,
      barcode: barcode?.trim() || null,
      sortOrder,
      rowLabel: rowLabel?.trim() || null,
      colLabel: colLabel?.trim() || null,
      binType: binType?.trim() || null,
      capacity: capacity ?? null,
      parentId: parentId ?? null,
    });

    const ctx = await resolveCtx(req);
    await recordAudit(pool, ctx, req, {
      source: 'settings.locations',
      action: AUDIT_ACTION.BIN_CREATE,
      entityType: AUDIT_ENTITY.BIN,
      entityId: (location as any)?.id ?? name.trim(),
      after: {
        name: name.trim(),
        room: room?.trim() || null,
        barcode: barcode?.trim() || null,
        row_label: rowLabel?.trim() || null,
        col_label: colLabel?.trim() || null,
        bin_type: binType?.trim() || null,
        capacity: capacity ?? null,
      },
      binCode: barcode?.trim() || null,
      locationCode: name.trim(),
    });

    return NextResponse.json({ success: true, location });
  } catch (err: any) {
    if (err?.message?.includes('unique') || err?.code === '23505') {
      return NextResponse.json({ error: 'Location name already exists' }, { status: 409 });
    }
    console.error('[POST /api/locations] error:', err);
    return NextResponse.json(
      { error: 'Failed to create location', details: err?.message },
      { status: 500 },
    );
  }
}
