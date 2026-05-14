import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { readTimeline } from '@/lib/inventory/events';

/**
 * GET /api/serial-units/:id
 * Returns one serial_units row (the unit's lifecycle state) plus a recent
 * timeline of inventory_events for that unit — used by the mobile /m/u/:id page.
 *
 * Accepts either a numeric serial_units.id or a serial_number string in the
 * URL segment; the route resolves the numeric id when given a string.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    return NextResponse.json({
      success: true,
      serial_unit: { ...unit, product_title: productTitle, received_by_name: receivedByName },
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load serial unit';
    console.error('serial-units/[id] GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
