import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { readTimeline } from '@/lib/inventory/events';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * GET /api/serial-units/:id
 * Returns one serial_units row (the unit's lifecycle state) plus a recent
 * timeline of inventory_events for that unit — used by the mobile /m/u/:id page.
 *
 * Accepts a numeric serial_units.id, a serial_number string, OR a minted
 * unit_uid ({SKU}-{YYWW}-{SEQ6}) in the URL segment — the last is what a
 * scanned products-label QR carries. Resolved in that order.
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

    const SELECT_COLS = `id, serial_number, normalized_serial, sku, sku_catalog_id,
                unit_uid,
                zoho_item_id, current_status::text AS current_status,
                current_location, condition_grade::text AS condition_grade,
                origin_source, origin_receiving_line_id,
                received_at, received_by,
                created_at, updated_at`;

    // Resolve in order: numeric id → normalized serial → minted unit_uid.
    // The unit_uid branch is what makes a scanned products-label QR resolve
    // instead of 404'ing (the QR carries the bare unit id, not the serial).
    let unit: Record<string, unknown> | null = null;
    if (/^\d+$/.test(raw)) {
      const r = await pool.query(
        `SELECT ${SELECT_COLS} FROM serial_units WHERE id = $1 LIMIT 1`,
        [Number(raw)],
      );
      unit = r.rows[0] ?? null;
    }
    if (!unit) {
      const r = await pool.query(
        `SELECT ${SELECT_COLS} FROM serial_units WHERE normalized_serial = UPPER(TRIM($1)) LIMIT 1`,
        [raw],
      );
      unit = r.rows[0] ?? null;
    }
    if (!unit) {
      const r = await pool.query(
        `SELECT ${SELECT_COLS} FROM serial_units WHERE unit_uid = $1 LIMIT 1`,
        [raw],
      );
      unit = r.rows[0] ?? null;
    }

    // Print fallback (opt-in via ?orPrint=1): products labels are often
    // unit-id labels that never registered a serial_units row, so the three
    // lookups above miss. Synthesize a read-only unit from the most recent
    // LABEL_PRINTED log for this unit_id, enriched with catalog + stock, so
    // the Recent/History detail pane can still show SKU, condition, location.
    if (!unit && request.nextUrl.searchParams.get('orPrint') === '1') {
      const printView = await buildPrintFallback(raw);
      if (printView) return NextResponse.json(printView);
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
      location_detail: Record<string, unknown> | null;
      stock: Record<string, unknown> | null;
    } | null = null;

    if (includeFull) {
      const unitId = Number(unit.id);
      const locationName =
        typeof unit.current_location === 'string' && unit.current_location.trim()
          ? unit.current_location.trim()
          : null;
      const [eventsFull, conditions, allocations, tsnLinks, locationDetail, stock] = await Promise.all([
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
        // Resolve the denormalized `current_location` string back to its full
        // bin row (room / zone / type) so the detail pane can show a rich
        // location card instead of a bare code. NULL when the unit isn't
        // stocked or the string doesn't match a known bin.
        locationName
          ? pool
              .query(
                `SELECT id, name, room, zone_letter, bin_type, barcode
                   FROM locations WHERE name = $1 LIMIT 1`,
                [locationName],
              )
              .then((r) => r.rows[0] ?? null)
              .catch(() => null)
          : Promise.resolve(null),
        // SKU-level inventory snapshot (loose + boxed on-hand) for the
        // inventory-linkage popover. Keyed by the unit's sku.
        unit.sku
          ? pool
              .query(
                `SELECT stock, boxed_stock, product_title
                   FROM sku_stock WHERE sku = $1 LIMIT 1`,
                [unit.sku],
              )
              .then((r) => r.rows[0] ?? null)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      fullDetail = {
        events_full: eventsFull,
        conditions,
        allocations,
        tsn_links: tsnLinks,
        location_detail: (locationDetail as Record<string, unknown> | null) ?? null,
        stock: (stock as Record<string, unknown> | null) ?? null,
      };
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

/**
 * Build a read-only unit view from the most recent LABEL_PRINTED log whose
 * metadata.unit_id matches `unitId`. Used when no serial_units row exists for
 * a printed products label. Returns null when there's no matching print.
 */
async function buildPrintFallback(unitId: string) {
  const sal = await pool.query<{
    id: number;
    staff_id: number | null;
    created_at: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, staff_id, created_at, metadata
       FROM station_activity_logs
      WHERE activity_type = 'LABEL_PRINTED'
        AND metadata->>'unit_id' = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [unitId],
  );
  const row = sal.rows[0];
  if (!row) return null;

  const md = row.metadata ?? {};
  const sku = (md.sku as string) ?? null;
  const skuCatalogId =
    md.sku_catalog_id != null && Number.isFinite(Number(md.sku_catalog_id))
      ? Number(md.sku_catalog_id)
      : null;
  const condition = (md.condition as string) ?? null;

  const [catalog, stock, staffRow, tsn, invEvent] = await Promise.all([
    skuCatalogId
      ? pool
          .query<{ product_title: string | null; image_url: string | null; category: string | null }>(
            `SELECT product_title, image_url, category FROM sku_catalog WHERE id = $1 LIMIT 1`,
            [skuCatalogId],
          )
          .then((r) => r.rows[0] ?? null)
          .catch(() => null)
      : Promise.resolve(null),
    sku
      ? pool
          .query<{ stock: number; boxed_stock: number; product_title: string | null; location: string | null }>(
            `SELECT stock, boxed_stock, product_title, location FROM sku_stock WHERE sku = $1 LIMIT 1`,
            [sku],
          )
          .then((r) => r.rows[0] ?? null)
          .catch(() => null)
      : Promise.resolve(null),
    row.staff_id != null
      ? pool
          .query<{ name: string | null }>(`SELECT name FROM staff WHERE id = $1 LIMIT 1`, [row.staff_id])
          .then((r) => r.rows[0]?.name ?? null)
          .catch(() => null)
      : Promise.resolve(null),
    // The serial actually LINKED to this printed label, via the SKU↔serial
    // lineage (tech_serial_numbers.context_station_activity_log_id).
    pool
      .query<{ serial_number: string | null; serial_unit_id: number | null }>(
        `SELECT serial_number, serial_unit_id
           FROM tech_serial_numbers
          WHERE context_station_activity_log_id = $1
          ORDER BY id ASC
          LIMIT 1`,
        [row.id],
      )
      .then((r) => r.rows[0] ?? null)
      .catch(() => null),
    // Authoritative QR→unit link: the LABELED inventory_event the print wrote
    // carries the serial_unit_id it labeled (its scan_token is the QR payload
    // and payload.unit_id is this unit id). This resolves even when the label
    // was a reprint whose minted unit_id differs from the unit's own unit_uid.
    pool
      .query<{ serial_unit_id: number | null }>(
        `SELECT serial_unit_id
           FROM inventory_events
          WHERE serial_unit_id IS NOT NULL
            AND (payload->>'unit_id' = $1 OR scan_token = $1)
          ORDER BY occurred_at DESC, id DESC
          LIMIT 1`,
        [unitId],
      )
      .then((r) => r.rows[0] ?? null)
      .catch(() => null),
  ]);

  // Resolve the linked serial_units row — prefer the tech-serial lineage, then
  // the LABELED event's serial_unit_id. That row holds the REAL device serial.
  const resolvedSerialUnitId = tsn?.serial_unit_id ?? invEvent?.serial_unit_id ?? null;
  const liveUnit = resolvedSerialUnitId
    ? await pool
        .query<{
          id: number;
          serial_number: string | null;
          unit_uid: string | null;
          current_status: string;
          current_location: string | null;
          condition_grade: string | null;
          received_at: string | null;
          received_by: number | null;
        }>(
          `SELECT id, serial_number, unit_uid, current_status::text AS current_status,
                  current_location, condition_grade::text AS condition_grade,
                  received_at, received_by
             FROM serial_units WHERE id = $1 LIMIT 1`,
          [resolvedSerialUnitId],
        )
        .then((r) => r.rows[0] ?? null)
        .catch(() => null)
    : null;
  // The device serial: tech-serial string → linked unit's serial → unit id.
  const linkedSerial = tsn?.serial_number?.trim() || liveUnit?.serial_number?.trim() || null;

  // SKU-level stock location is the best "where do these live" for an
  // unstocked printed label — resolve it to a full bin row when known.
  const locationName = stock?.location?.trim() || null;
  const locationDetail = locationName
    ? await pool
        .query(
          `SELECT id, name, room, zone_letter, bin_type, barcode FROM locations WHERE name = $1 LIMIT 1`,
          [locationName],
        )
        .then((r) => r.rows[0] ?? null)
        .catch(() => null)
    : null;

  const productTitle = catalog?.product_title ?? stock?.product_title ?? null;
  // Serial = the serial linked to the QR label (tech_serial_numbers), falling
  // back to the minted unit id for auto-issue labels that reuse it as serial.
  const serial = linkedSerial ?? unitId;
  const serialUnit = {
    id: liveUnit?.id ?? 0,
    serial_number: serial,
    normalized_serial: serial.toUpperCase(),
    unit_uid: unitId,
    sku,
    sku_catalog_id: skuCatalogId,
    current_status: liveUnit?.current_status ?? 'LABELED',
    current_location: liveUnit?.current_location ?? locationName,
    condition_grade: liveUnit?.condition_grade ?? condition,
    origin_source: 'label_print',
    origin_receiving_line_id: null,
    received_at: liveUnit?.received_at ?? row.created_at,
    received_by: liveUnit?.received_by ?? row.staff_id,
    received_by_name: staffRow,
    product_title: productTitle,
    created_at: row.created_at,
    updated_at: row.created_at,
  };

  // One synthetic timeline entry for the print itself.
  const events = [
    {
      id: row.id,
      occurred_at: row.created_at,
      event_type: 'LABELED',
      station: 'LABELS',
      prev_status: null,
      next_status: 'LABELED',
      bin_id: null,
      bin_name: null,
      actor_staff_id: row.staff_id,
      actor_name: staffRow,
      scan_token: null,
      notes: null,
      payload: { print_class: md.print_class ?? null, gtin: md.gtin ?? null },
    },
  ];

  return {
    success: true,
    source: 'print',
    serial_unit: serialUnit,
    events,
    events_full: events,
    conditions: [],
    allocations: [],
    tsn_links: [],
    location_detail: locationDetail,
    stock: stock
      ? { stock: stock.stock, boxed_stock: stock.boxed_stock, product_title: stock.product_title }
      : null,
  };
}
