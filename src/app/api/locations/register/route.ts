import { NextRequest, NextResponse } from 'next/server';
import { registerPrintedLocations } from '@/lib/neon/location-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';
import type { LocationSegments } from '@/lib/barcode-routing';

/**
 * POST /api/locations/register
 *
 * Upsert backing `locations` rows for a batch of printer-format
 * addresses. Called by the Location Label Printer BEFORE window.print()
 * so every printed sticker has a row — required for putaway scans and
 * audit trails to resolve.
 *
 * Body: {
 *   room: string,
 *   segments: Array<{ zone, aisle, bay, level, position }>,
 *   binType?: string | null,
 *   capacity?: number | null,
 * }
 * Returns: { success: true, registered: number, bins: Location[] }
 *
 * Idempotent: re-printing the same label is a no-op; soft-deleted rows
 * are reactivated.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const room = String(body?.room ?? '').trim();
    const segmentsIn = Array.isArray(body?.segments) ? body.segments : [];
    if (!room) {
      return NextResponse.json({ error: 'room is required' }, { status: 400 });
    }
    if (segmentsIn.length === 0) {
      return NextResponse.json({ error: 'segments[] is required' }, { status: 400 });
    }
    if (segmentsIn.length > 500) {
      return NextResponse.json(
        { error: 'Too many segments — max 500 per call' },
        { status: 400 },
      );
    }

    const segments: LocationSegments[] = [];
    for (const raw of segmentsIn) {
      const zone = String(raw?.zone ?? '').trim().toUpperCase();
      const aisle = Number(raw?.aisle);
      const bay = Number(raw?.bay);
      const level = Number(raw?.level);
      const position = Number(raw?.position);
      if (!/^[A-Z]$/.test(zone)) {
        return NextResponse.json(
          { error: `Invalid zone letter "${zone}" — expected A–Z` },
          { status: 400 },
        );
      }
      if (![aisle, bay, level].every((n) => Number.isFinite(n) && n >= 1 && n <= 99)) {
        return NextResponse.json(
          { error: 'aisle/bay/level must each be a number in 1..99' },
          { status: 400 },
        );
      }
      // position=0 is the rack-label sentinel (whole-rack label printed
      // by the Rack Label Printer). Bin labels use 1..99.
      if (!Number.isFinite(position) || position < 0 || position > 99) {
        return NextResponse.json(
          { error: 'position must be 0 (rack label) or 1..99 (bin label)' },
          { status: 400 },
        );
      }
      segments.push({
        zone,
        aisle: Math.floor(aisle),
        bay: Math.floor(bay),
        level: Math.floor(level),
        position: Math.floor(position),
      });
    }

    const result = await registerPrintedLocations({
      room,
      segments,
      binType: typeof body?.binType === 'string' ? body.binType.trim() || null : null,
      capacity: typeof body?.capacity === 'number' ? body.capacity : null,
    }, ctx.organizationId);

    // Audit floor — log only when we actually inserted/reactivated rows
    // (re-prints of existing live bins are silent).
    if (result.registered > 0) {
      await recordAudit(pool, ctx, req, {
        source: 'inventory.label.register',
        action: AUDIT_ACTION.BIN_CREATE,
        entityType: AUDIT_ENTITY.BIN,
        entityId: result.bins.map((b) => b.id).join(','),
        after: {
          room,
          registered: result.registered,
          barcodes: result.bins.map((b) => b.barcode).filter(Boolean),
        },
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[POST /api/locations/register] error:', err);
    return NextResponse.json(
      { error: 'Failed to register printed locations', details: err?.message },
      { status: 500 },
    );
  }
}, { permission: 'print.label' });
