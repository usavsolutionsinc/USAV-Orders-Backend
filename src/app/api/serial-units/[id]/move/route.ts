import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { findByNormalizedSerial } from '@/lib/neon/serial-units-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';
import {
  findLocationByBarcode,
  findLocationByName,
  getLocationById,
} from '@/lib/repositories/inventory/locations';

/**
 * POST /api/serial-units/[id]/move — move a unit into a bin/zone.
 *
 * Resolves the target location by `bin_barcode`, `bin_name`, or `bin_id`
 * (first non-empty wins). Updates `serial_units.current_location` to the
 * canonical bin name and emits an `inventory_events` MOVED row carrying
 * `prev_bin_id` + `bin_id` so the History Log shows the actual transition.
 *
 * Body:
 *   {
 *     bin_barcode?: string;
 *     bin_name?: string;
 *     bin_id?: number;
 *     notes?: string;
 *     client_event_id?: string; // idempotency key
 *   }
 *
 * Notes:
 *   - We DO NOT touch bin_contents/qty here. That projection is maintained
 *     via sku_stock_ledger triggers; serial moves don't change a SKU's
 *     total stock, only its location. See locations repo header.
 *   - If the unit has no prior location, this acts as the first putaway.
 */
export const POST = withAuth(
  async (request: NextRequest, ctx) => {
    const idParam = extractIdSegment(request.nextUrl.pathname);
    if (!idParam) {
      return NextResponse.json({ error: 'serial unit id or serial number required' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const binBarcode =
      typeof body.bin_barcode === 'string' && body.bin_barcode.trim() ? body.bin_barcode.trim() : null;
    const binName =
      typeof body.bin_name === 'string' && body.bin_name.trim() ? body.bin_name.trim() : null;
    const binIdRaw =
      typeof body.bin_id === 'number' && Number.isFinite(body.bin_id) ? body.bin_id : null;
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const clientEventId =
      typeof body.client_event_id === 'string' ? body.client_event_id : null;

    if (!binBarcode && !binName && binIdRaw == null) {
      return NextResponse.json(
        { error: 'bin_barcode, bin_name, or bin_id is required' },
        { status: 400 },
      );
    }

    // 1. Resolve target location.
    let target =
      binBarcode != null ? await findLocationByBarcode(binBarcode) : null;
    if (!target && binName != null) target = await findLocationByName(binName);
    if (!target && binIdRaw != null) target = await getLocationById(binIdRaw);
    if (!target) {
      return NextResponse.json(
        { error: `Location not found (${binBarcode || binName || binIdRaw})` },
        { status: 404 },
      );
    }

    // 2. Resolve the unit + its current location for the prev_bin_id field.
    const unit = await resolveUnit(idParam);
    if (!unit) {
      return NextResponse.json({ error: 'Serial unit not found' }, { status: 404 });
    }

    const prevLocationName = unit.current_location;
    let prevBinId: number | null = null;
    if (prevLocationName) {
      const prevLoc =
        (await findLocationByName(prevLocationName)) ??
        (await findLocationByBarcode(prevLocationName));
      prevBinId = prevLoc?.id ?? null;
    }

    if (prevBinId === target.id && prevLocationName === target.name) {
      // Already there — idempotent return.
      return NextResponse.json({
        success: true,
        unit_id: unit.id,
        location: { id: target.id, name: target.name, barcode: target.barcode },
        unchanged: true,
      });
    }

    // 3. Update current_location. Storing the canonical name keeps
    //    serial_units self-describing without forcing a join for read paths.
    try {
      await pool.query(
        `UPDATE serial_units
           SET current_location = $1,
               updated_at = NOW()
         WHERE id = $2`,
        [target.name, unit.id],
      );
    } catch (err) {
      console.error('[move] update serial_units.current_location failed', err);
      const msg = err instanceof Error ? err.message : 'Move failed';
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // 4. Lifecycle event.
    try {
      await recordInventoryEvent({
        event_type: 'MOVED',
        actor_staff_id: ctx.staffId ?? null,
        station: 'MOBILE',
        serial_unit_id: unit.id,
        sku: unit.sku,
        bin_id: target.id,
        prev_bin_id: prevBinId,
        client_event_id: clientEventId,
        notes,
        scan_token: binBarcode ?? null,
        payload: {
          from: prevLocationName,
          to: target.name,
        },
      });
    } catch (err) {
      console.warn('[move] MOVED event failed (non-fatal)', err);
    }

    return NextResponse.json({
      success: true,
      unit_id: unit.id,
      location: { id: target.id, name: target.name, barcode: target.barcode },
      previous_location: prevLocationName,
    });
  },
  { permission: 'tech.scan_serial' },
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractIdSegment(pathname: string): string {
  const m = /\/api\/serial-units\/([^/]+)\/move/.exec(pathname);
  return m ? decodeURIComponent(m[1] || '').trim() : '';
}

interface UnitLite {
  id: number;
  sku: string | null;
  current_location: string | null;
}

async function resolveUnit(raw: string): Promise<UnitLite | null> {
  if (/^\d+$/.test(raw)) {
    const r = await pool.query<UnitLite>(
      `SELECT id, sku, current_location FROM serial_units WHERE id = $1 LIMIT 1`,
      [Number(raw)],
    );
    if (r.rows[0]) return r.rows[0];
  }
  const fallback = await findByNormalizedSerial(raw);
  if (!fallback) return null;
  return {
    id: fallback.id,
    sku: fallback.sku ?? null,
    current_location: fallback.current_location ?? null,
  };
}
