import { NextRequest, NextResponse } from 'next/server';
import { bulkCreateBinRange } from '@/lib/neon/location-queries';

/**
 * POST /api/locations/bulk
 * Body: { room, rowLabel, colStart, colEnd, binType?, capacity? }
 * Returns: { created, bins[] } — existing bins are reused, not duplicated.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const room = String(body?.room ?? '').trim();
    const rowLabel = String(body?.rowLabel ?? '').trim();
    const colStart = Number(body?.colStart);
    const colEnd = Number(body?.colEnd);

    if (!room || !rowLabel) {
      return NextResponse.json(
        { error: 'room and rowLabel are required' },
        { status: 400 },
      );
    }
    if (!Number.isFinite(colStart) || !Number.isFinite(colEnd)) {
      return NextResponse.json(
        { error: 'colStart and colEnd must be numbers' },
        { status: 400 },
      );
    }
    if (Math.abs(colEnd - colStart) > 200) {
      return NextResponse.json(
        { error: 'Range too large (max 200 bins per call)' },
        { status: 400 },
      );
    }

    const result = await bulkCreateBinRange({
      room,
      rowLabel,
      colStart,
      colEnd,
      binType: body?.binType ?? null,
      capacity: typeof body?.capacity === 'number' ? body.capacity : null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[POST /api/locations/bulk] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}
