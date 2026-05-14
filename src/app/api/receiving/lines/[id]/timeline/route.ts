import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { readTimeline } from '@/lib/inventory/events';

/**
 * GET /api/receiving/lines/:id/timeline?limit=&since=
 * Returns the inventory_events timeline for one line, enriched with
 * actor name + bin name for display.
 */
export async function GET(
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

    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1),
      1000,
    );
    const since = searchParams.get('since');

    const rawEvents = await readTimeline({
      receiving_line_id: lineId,
      since: since && since.trim() ? since.trim() : null,
      limit,
    });

    if (rawEvents.length === 0) {
      return NextResponse.json({ success: true, events: [] });
    }

    // Enrich with staff names + bin names + serial numbers in two batched
    // lookups. Keeps the mobile page response self-contained.
    const staffIds = Array.from(
      new Set(
        rawEvents
          .map((e) => e.actor_staff_id)
          .filter((v): v is number => v != null),
      ),
    );
    const binIds = Array.from(
      new Set(
        rawEvents
          .flatMap((e) => [e.bin_id, e.prev_bin_id])
          .filter((v): v is number => v != null),
      ),
    );
    const serialIds = Array.from(
      new Set(
        rawEvents
          .map((e) => e.serial_unit_id)
          .filter((v): v is number => v != null),
      ),
    );

    const staffMap = new Map<number, string>();
    if (staffIds.length > 0) {
      const r = await pool.query<{ id: number; name: string }>(
        `SELECT id, name FROM staff WHERE id = ANY($1::int[])`,
        [staffIds],
      );
      for (const row of r.rows) staffMap.set(row.id, row.name);
    }

    const binMap = new Map<number, string>();
    if (binIds.length > 0) {
      const r = await pool.query<{ id: number; name: string }>(
        `SELECT id, name FROM locations WHERE id = ANY($1::int[])`,
        [binIds],
      );
      for (const row of r.rows) binMap.set(row.id, row.name);
    }

    const serialMap = new Map<number, string>();
    if (serialIds.length > 0) {
      const r = await pool.query<{ id: number; serial_number: string }>(
        `SELECT id, serial_number FROM serial_units WHERE id = ANY($1::int[])`,
        [serialIds],
      );
      for (const row of r.rows) serialMap.set(row.id, row.serial_number);
    }

    const events = rawEvents.map((e) => ({
      id: e.id,
      occurred_at: e.occurred_at,
      event_type: e.event_type,
      actor_staff_id: e.actor_staff_id,
      actor_name: e.actor_staff_id != null ? staffMap.get(e.actor_staff_id) ?? null : null,
      station: e.station,
      sku: e.sku,
      serial_unit_id: e.serial_unit_id,
      serial_number:
        e.serial_unit_id != null ? serialMap.get(e.serial_unit_id) ?? null : null,
      bin_id: e.bin_id,
      bin_name: e.bin_id != null ? binMap.get(e.bin_id) ?? null : null,
      prev_bin_id: e.prev_bin_id,
      prev_bin_name:
        e.prev_bin_id != null ? binMap.get(e.prev_bin_id) ?? null : null,
      prev_status: e.prev_status,
      next_status: e.next_status,
      notes: e.notes,
      payload: e.payload,
    }));

    return NextResponse.json({ success: true, events });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read timeline';
    console.error('receiving/lines/timeline GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
