import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import {
  recordInventoryEvent,
  type InventoryEventStation,
} from '@/lib/inventory/events';

/**
 * Stash all (or some) units of a receiving line into a physical bin.
 *
 *   POST /api/receiving/lines/:id/putaway
 *   { bin_barcode | bin_id, qty?, serial_unit_id?, staff_id?,
 *     client_event_id?, scan_token?, notes? }
 *
 * Writes:
 *   - inventory_events PUTAWAY (per unit; idempotent on client_event_id:N)
 *   - serial_units.current_location + current_status='STOCKED' (when serial)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idRaw } = await params;
    const lineId = Number(idRaw);
    if (!Number.isFinite(lineId) || lineId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid line id is required' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));

    const binBarcode = String(body?.bin_barcode || '').trim();
    const binIdRaw = Number(body?.bin_id);
    const binIdFromBody =
      Number.isFinite(binIdRaw) && binIdRaw > 0 ? Math.floor(binIdRaw) : null;
    const qtyRaw = Number(body?.qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1;

    const serialUnitIdRaw = Number(body?.serial_unit_id);
    const serialUnitId =
      Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0
        ? Math.floor(serialUnitIdRaw)
        : null;

    const staffIdRaw = Number(body?.staff_id ?? body?.staffId);
    const staffId =
      Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;

    const notes = String(body?.notes || '').trim() || null;
    const clientEventId = String(body?.client_event_id || '').trim() || null;
    const scanToken = String(body?.scan_token || '').trim() || null;
    const stationRaw = String(body?.station || '').trim().toUpperCase();
    const station: InventoryEventStation =
      stationRaw === 'TECH' || stationRaw === 'RECEIVING'
        ? (stationRaw as InventoryEventStation)
        : 'MOBILE';

    if (!binBarcode && !binIdFromBody) {
      return NextResponse.json(
        { success: false, error: 'bin_barcode or bin_id is required' },
        { status: 400 },
      );
    }

    // Resolve the bin.
    type BinRow = { id: number; name: string; barcode: string | null };
    let bin: BinRow | null = null;
    if (binIdFromBody) {
      const r = await pool.query<BinRow>(
        `SELECT id, name, barcode FROM locations WHERE id = $1 LIMIT 1`,
        [binIdFromBody],
      );
      bin = r.rows[0] ?? null;
    } else {
      const r = await pool.query<BinRow>(
        `SELECT id, name, barcode FROM locations
         WHERE barcode = $1 OR LOWER(name) = LOWER($1)
         LIMIT 1`,
        [binBarcode],
      );
      bin = r.rows[0] ?? null;
    }
    if (!bin) {
      return NextResponse.json(
        { success: false, error: `Bin not found: ${binBarcode || binIdFromBody}` },
        { status: 404 },
      );
    }

    // Load line state for receiving_id + sku.
    const lineRes = await pool.query<{
      id: number;
      receiving_id: number | null;
      sku: string | null;
    }>(
      `SELECT id, receiving_id, sku FROM receiving_lines WHERE id = $1 LIMIT 1`,
      [lineId],
    );
    const line = lineRes.rows[0];
    if (!line) {
      return NextResponse.json(
        { success: false, error: `receiving_line ${lineId} not found` },
        { status: 404 },
      );
    }

    // Find prior bin for this line/serial (most recent PUTAWAY or MOVED event).
    const priorBinRes = await pool.query<{ bin_id: number | null }>(
      `SELECT bin_id FROM inventory_events
       WHERE event_type IN ('PUTAWAY','MOVED')
         AND (
           ($1::int IS NOT NULL AND serial_unit_id = $1)
           OR ($1::int IS NULL AND serial_unit_id IS NULL AND receiving_line_id = $2)
         )
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1`,
      [serialUnitId, lineId],
    );
    const prevBinId = priorBinRes.rows[0]?.bin_id ?? null;

    // Update serial_units location/status (only when serialized).
    if (serialUnitId) {
      await pool.query(
        `UPDATE serial_units
         SET current_location = $2,
             current_status   = 'STOCKED'::serial_status_enum,
             updated_at       = NOW()
         WHERE id = $1`,
        [serialUnitId, bin.name],
      );
    }

    // Write one PUTAWAY event per unit so the timeline stays per-unit even
    // for non-serialized putaways. Idempotent via client_event_id:N.
    const events: Array<{ id: number }> = [];
    for (let i = 0; i < qty; i++) {
      const ev = await recordInventoryEvent({
        event_type: 'PUTAWAY',
        actor_staff_id: staffId,
        station,
        receiving_id: line.receiving_id,
        receiving_line_id: line.id,
        serial_unit_id: serialUnitId,
        sku: line.sku,
        bin_id: bin.id,
        prev_bin_id: prevBinId,
        prev_status: null,
        next_status: serialUnitId ? 'STOCKED' : null,
        scan_token: scanToken,
        client_event_id: clientEventId ? `${clientEventId}:put-${i + 1}` : null,
        notes,
        payload: { qty: 1, unit_index: i + 1, of_qty: qty, bin_name: bin.name },
      });
      events.push({ id: ev.id });
    }

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-lines', 'sku-stock', 'serial-units']);
        if (line.receiving_id != null) {
          await publishReceivingLogChanged({
            action: 'update',
            rowId: String(line.receiving_id),
            source: 'receiving.lines.putaway',
          });
        }
      } catch (err) {
        console.warn('receiving/lines/putaway: cache/realtime failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      line_id: lineId,
      bin: { id: bin.id, name: bin.name, barcode: bin.barcode },
      qty,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to putaway';
    console.error('receiving/lines/putaway POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
