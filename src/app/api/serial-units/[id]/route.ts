import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { readTimeline } from '@/lib/inventory/events';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * GET /api/serial-units/:id
 * Returns one serial_units row (the unit's lifecycle state) plus a recent
 * timeline of inventory_events for that unit — used by the mobile /m/u/:id page.
 *
 * Accepts either a numeric serial_units.id or a serial_number string in the
 * URL segment; the route resolves the numeric id when given a string.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(request, 'sku_stock.view');
  if (gate.denied) return gate.denied;
  try {
    const { id: idRaw } = await params;
    const raw = decodeURIComponent(idRaw || '').trim();
    if (!raw) {
      return NextResponse.json(
        { success: false, error: 'serial unit id or serial number required' },
        { status: 400 },
      );
    }

    // Try numeric id first; fall back to normalized serial number lookup.
    let unit: Record<string, unknown> | null = null;
    if (/^\d+$/.test(raw)) {
      const r = await pool.query(
        `SELECT id, serial_number, normalized_serial, sku, sku_catalog_id,
                zoho_item_id, current_status::text AS current_status,
                current_location, condition_grade::text AS condition_grade,
                origin_source, origin_receiving_line_id,
                received_at, received_by,
                created_at, updated_at
         FROM serial_units WHERE id = $1 LIMIT 1`,
        [Number(raw)],
      );
      unit = r.rows[0] ?? null;
    }
    if (!unit) {
      const r = await pool.query(
        `SELECT id, serial_number, normalized_serial, sku, sku_catalog_id,
                zoho_item_id, current_status::text AS current_status,
                current_location, condition_grade::text AS condition_grade,
                origin_source, origin_receiving_line_id,
                received_at, received_by,
                created_at, updated_at
         FROM serial_units WHERE normalized_serial = UPPER(TRIM($1)) LIMIT 1`,
        [raw],
      );
      unit = r.rows[0] ?? null;
    }

    if (!unit) {
      return NextResponse.json(
        { success: false, error: 'Serial unit not found' },
        { status: 404 },
      );
    }

    const events = await readTimeline({
      serial_unit_id: Number(unit.id),
      limit: 50,
    });

    // Inline product title + receiver name for display.
    let productTitle: string | null = null;
    if (unit.sku) {
      const r = await pool.query<{ product_title: string | null }>(
        `SELECT COALESCE(sc.product_title, ss.product_title) AS product_title
         FROM sku_stock ss
         LEFT JOIN sku_catalog sc ON sc.sku = ss.sku
         WHERE ss.sku = $1 LIMIT 1`,
        [unit.sku],
      );
      productTitle = r.rows[0]?.product_title ?? null;
    }

    let receivedByName: string | null = null;
    if (unit.received_by != null) {
      const r = await pool.query<{ name: string | null }>(
        `SELECT name FROM staff WHERE id = $1 LIMIT 1`,
        [unit.received_by],
      );
      receivedByName = r.rows[0]?.name ?? null;
    }

    // Optional rich detail — events timeline (full, oldest-first), condition
    // history, allocations, and tsn cross-refs. Mirrors the legacy
    // /admin/inventory/units/[ref] page so the inventory shell can render
    // the same view without bouncing through admin SSR.
    const includeFull = request.nextUrl.searchParams.get('include') === 'full';
    let fullDetail: {
      events_full: unknown[];
      conditions: unknown[];
      allocations: unknown[];
      tsn_links: unknown[];
    } | null = null;

    if (includeFull) {
      const unitId = Number(unit.id);
      const [eventsFull, conditions, allocations, tsnLinks] = await Promise.all([
        pool
          .query(
            `SELECT ie.id, ie.occurred_at, ie.event_type, ie.station,
                    ie.prev_status, ie.next_status,
                    ie.bin_id, l.name AS bin_name,
                    ie.stock_ledger_id,
                    ie.actor_staff_id, s.name AS actor_name,
                    ie.scan_token, ie.client_event_id,
                    ie.notes, ie.payload
               FROM inventory_events ie
               LEFT JOIN staff s ON s.id = ie.actor_staff_id
               LEFT JOIN locations l ON l.id = ie.bin_id
              WHERE ie.serial_unit_id = $1
              ORDER BY ie.occurred_at ASC, ie.id ASC`,
            [unitId],
          )
          .then((r) => r.rows)
          .catch(() => [] as unknown[]),
        pool
          .query(
            `SELECT h.id, h.assessed_at,
                    h.assessed_by_staff_id, s.name AS assessed_by_name,
                    h.prev_grade::text AS prev_grade,
                    h.new_grade::text AS new_grade,
                    h.cosmetic_notes, h.functional_notes,
                    h.inventory_event_id
               FROM serial_unit_condition_history h
               LEFT JOIN staff s ON s.id = h.assessed_by_staff_id
              WHERE h.serial_unit_id = $1
              ORDER BY h.assessed_at ASC, h.id ASC`,
            [unitId],
          )
          .then((r) => r.rows)
          .catch(() => [] as unknown[]),
        pool
          .query(
            `SELECT a.id, a.order_id, a.allocated_at,
                    a.state::text AS state,
                    a.released_at, a.released_reason,
                    s.name AS allocated_by_name
               FROM order_unit_allocations a
               LEFT JOIN staff s ON s.id = a.allocated_by_staff_id
              WHERE a.serial_unit_id = $1
              ORDER BY a.allocated_at DESC, a.id DESC`,
            [unitId],
          )
          .then((r) => r.rows)
          .catch(() => [] as unknown[]),
        pool
          .query(
            `SELECT tsn.id, tsn.station_source, tsn.shipment_id,
                    tsn.serial_type, tsn.fnsku,
                    s.name AS tested_by_name, tsn.created_at
               FROM tech_serial_numbers tsn
               LEFT JOIN staff s ON s.id = tsn.tested_by
              WHERE tsn.serial_unit_id = $1
              ORDER BY tsn.created_at ASC, tsn.id ASC`,
            [unitId],
          )
          .then((r) => r.rows)
          .catch(() => [] as unknown[]),
      ]);
      fullDetail = { events_full: eventsFull, conditions, allocations, tsn_links: tsnLinks };
    }

    return NextResponse.json({
      success: true,
      serial_unit: { ...unit, product_title: productTitle, received_by_name: receivedByName },
      events,
      ...(fullDetail ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load serial unit';
    console.error('serial-units/[id] GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
