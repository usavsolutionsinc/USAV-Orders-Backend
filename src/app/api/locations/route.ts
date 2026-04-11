import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveLocations,
  getRooms,
  createLocation,
  getLowStockBins,
} from '@/lib/neon/location-queries';

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
