import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { readTimeline } from '@/lib/inventory/events';

/**
 * GET /api/inventory-events
 * Generic audit feed. Filterable by any subject: sku, serial_unit_id, bin_id,
 * receiving_id, receiving_line_id, actor_staff_id, since, limit.
 *
 * Used by the bin page, the SKU detail timeline, and the future /audit page.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const num = (key: string): number | null => {
      const v = searchParams.get(key);
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };

    const rawEvents = await readTimeline({
      sku: searchParams.get('sku') || undefined,
      serial_unit_id: num('serial_unit_id'),
      bin_id: num('bin_id'),
      receiving_id: num('receiving_id'),
      receiving_line_id: num('receiving_line_id'),
      actor_staff_id: num('actor_staff_id'),
      since: searchParams.get('since') || null,
      limit: num('limit') ?? 50,
    });

    if (rawEvents.length === 0) {
      return NextResponse.json({ success: true, events: [] });
    }

    // Enrich subject names in two batched lookups.
    const staffIds = Array.from(
      new Set(rawEvents.map((e) => e.actor_staff_id).filter((v): v is number => v != null)),
    );
    const binIds = Array.from(
      new Set(
        rawEvents
          .flatMap((e) => [e.bin_id, e.prev_bin_id])
          .filter((v): v is number => v != null),
      ),
    );
    const serialIds = Array.from(
      new Set(rawEvents.map((e) => e.serial_unit_id).filter((v): v is number => v != null)),
    );

    const staffMap = new Map<number, string>();
    const binMap = new Map<number, string>();
    const serialMap = new Map<number, string>();

    if (staffIds.length > 0) {
      const r = await pool.query<{ id: number; name: string }>(
        `SELECT id, name FROM staff WHERE id = ANY($1::int[])`,
        [staffIds],
      );
      for (const row of r.rows) staffMap.set(row.id, row.name);
    }
    if (binIds.length > 0) {
      const r = await pool.query<{ id: number; name: string }>(
        `SELECT id, name FROM locations WHERE id = ANY($1::int[])`,
        [binIds],
      );
      for (const row of r.rows) binMap.set(row.id, row.name);
    }
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
      actor_name:
        e.actor_staff_id != null ? staffMap.get(e.actor_staff_id) ?? null : null,
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
      receiving_id: e.receiving_id,
      receiving_line_id: e.receiving_line_id,
    }));

    return NextResponse.json({ success: true, events });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read events';
    console.error('inventory-events GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
