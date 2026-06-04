/**
 * Read-only aggregator for the Tech audit-log section.
 *
 * Sources:
 *   • tech_serial_numbers        — one row per serial scanned by a tech
 *   • station_activity_logs      — granular events tagged with tech_serial_number_id
 *   • audit_logs                 — entity_type='TECH_SERIAL' or station_activity_log_id matches
 *   • sku                        — resolved via tech_serial_numbers.source_sku_id
 *   • orders                     — fallback SKU summary via shipment_id
 *   • shipping_tracking_numbers  — canonical tracking text
 *
 * A "session" is grouped by tracking (per the locked-in plan trade-off).
 */

import 'server-only';
import pool from '@/lib/db';
import type { AuditLogFilters } from './filters';
import { readInventorySpine } from './inventory-spine';

export interface TechSessionSummary {
  /** The value to pass back as `?session=` (a tracking number or a PO id). */
  session_key: string;
  /** Human-facing label (tracking number, or PO number/id). */
  tracking: string;
  tester_id: number | null;
  tester_name: string | null;
  serial_count: number;
  latest_event_at: string | null;
  sku_summary: string | null;
}

export interface TechEvent {
  id: string;
  occurred_at: string;
  source: 'tech_serial_number' | 'station_activity_log' | 'audit_log' | 'inventory_event';
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  serial_number: string | null;
  sku: string | null;
  notes: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

export interface TechSessionDetail {
  tracking: string;
  serials: Array<{
    id: number;
    serial_number: string;
    serial_type: string | null;
    test_date_time: string | null;
    tester_id: number | null;
    tester_name: string | null;
    sku: string | null;
  }>;
  events: TechEvent[];
  sku_summary: string | null;
}

interface ListOpts {
  filters: AuditLogFilters;
  search: string | null;
}

export async function listTechSessions(opts: ListOpts): Promise<TechSessionSummary[]> {
  const { filters, search } = opts;
  const params: unknown[] = [];

  // Shared filter values are pushed once; both anchor CTEs reference the same
  // positional placeholders (Postgres allows reusing a $n in multiple spots).
  let pStart = 0;
  let pEnd = 0;
  let pStaff = 0;
  let pSku = 0;
  let pSearch = 0;
  if (filters.range.start) {
    params.push(filters.range.start);
    pStart = params.length;
  }
  if (filters.range.end) {
    params.push(filters.range.end);
    pEnd = params.length;
  }
  if (filters.staffId != null) {
    params.push(filters.staffId);
    pStaff = params.length;
  }
  if (filters.sku) {
    params.push(filters.sku);
    pSku = params.length;
  }
  if (search) {
    params.push(`%${search}%`);
    pSearch = params.length;
  }

  // ── Shipment-anchored sessions (legacy / standalone tech, keyed by tracking) ──
  const shipWhere: string[] = ['tsn.shipment_id IS NOT NULL'];
  if (pStart) shipWhere.push(`tsn.created_at >= $${pStart}::timestamptz`);
  if (pEnd) shipWhere.push(`tsn.created_at <= $${pEnd}::timestamptz`);
  if (pStaff) shipWhere.push(`tsn.tested_by = $${pStaff}`);
  if (pSku) {
    shipWhere.push(`(
      EXISTS (SELECT 1 FROM sku sk WHERE sk.id = tsn.source_sku_id AND sk.static_sku = $${pSku})
      OR EXISTS (SELECT 1 FROM orders o WHERE o.shipment_id = tsn.shipment_id AND o.sku = $${pSku})
    )`);
  }
  if (pSearch) {
    shipWhere.push(`(
      stn.tracking_number_raw ILIKE $${pSearch}
      OR tsn.serial_number ILIKE $${pSearch}
      OR COALESCE(s.name, '') ILIKE $${pSearch}
    )`);
  }

  // ── PO-anchored sessions (receiving lines that were tested — "Line under PO") ──
  const poWhere: string[] = ['rl.zoho_purchaseorder_id IS NOT NULL'];
  if (pStart) poWhere.push(`tr.created_at >= $${pStart}::timestamptz`);
  if (pEnd) poWhere.push(`tr.created_at <= $${pEnd}::timestamptz`);
  if (pStaff) poWhere.push(`tr.tested_by = $${pStaff}`);
  if (pSku) poWhere.push(`rl.sku = $${pSku}`);
  if (pSearch) {
    poWhere.push(`(
      COALESCE(rr.zoho_po_number, '') ILIKE $${pSearch}
      OR COALESCE(rl.sku, '') ILIKE $${pSearch}
      OR COALESCE(rl.item_name, '') ILIKE $${pSearch}
    )`);
  }

  params.push(filters.limit);
  const limitParam = `$${params.length}`;
  params.push(filters.offset);
  const offsetParam = `$${params.length}`;

  // sku_summary is computed via scalar subqueries (not joins) so the orders/sku
  // fan-out can't inflate serial_count.
  const sql = `
    WITH shipment_sessions AS (
      SELECT
        stn.tracking_number_raw AS session_key,
        stn.tracking_number_raw AS label,
        MAX(tsn.created_at)     AS latest_event_at,
        COUNT(*)::int           AS serial_count,
        MAX(tsn.tested_by)      AS tester_id,
        (
          SELECT string_agg(DISTINCT COALESCE(sk2.static_sku, o2.sku), ', ')
            FROM tech_serial_numbers tsn2
            LEFT JOIN sku sk2 ON sk2.id = tsn2.source_sku_id
            LEFT JOIN orders o2 ON o2.shipment_id = tsn2.shipment_id
           WHERE tsn2.shipment_id = tsn.shipment_id
             AND COALESCE(sk2.static_sku, o2.sku) IS NOT NULL
        ) AS sku_summary
      FROM tech_serial_numbers tsn
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
      LEFT JOIN staff s ON s.id = tsn.tested_by
      WHERE ${shipWhere.join(' AND ')}
      GROUP BY stn.tracking_number_raw, tsn.shipment_id
    ),
    po_sessions AS (
      SELECT
        rl.zoho_purchaseorder_id AS session_key,
        COALESCE(rr.zoho_po_number, rl.zoho_purchaseorder_id) AS label,
        MAX(tr.created_at)                  AS latest_event_at,
        COUNT(DISTINCT tr.serial_unit_id)::int AS serial_count,
        MAX(tr.tested_by)                   AS tester_id,
        (
          SELECT string_agg(DISTINCT rl2.sku, ', ')
            FROM receiving_lines rl2
           WHERE rl2.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
             AND rl2.sku IS NOT NULL
        ) AS sku_summary
      FROM testing_results tr
      JOIN receiving_lines rl ON rl.id = tr.receiving_line_id
      LEFT JOIN replenishment_requests rr ON rr.zoho_po_id = rl.zoho_purchaseorder_id
      WHERE ${poWhere.join(' AND ')}
      GROUP BY rl.zoho_purchaseorder_id, rr.zoho_po_number
    ),
    combined AS (
      SELECT * FROM shipment_sessions
      UNION ALL
      SELECT * FROM po_sessions
    )
    SELECT
      c.session_key,
      c.label,
      c.latest_event_at,
      c.serial_count,
      c.tester_id,
      ts.name AS tester_name,
      c.sku_summary
    FROM combined c
    LEFT JOIN staff ts ON ts.id = c.tester_id
    ORDER BY c.latest_event_at DESC NULLS LAST
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;
  const { rows } = await pool.query(sql, params);

  return rows.map((r: Record<string, unknown>) => ({
    session_key: (r.session_key as string | null) ?? '',
    tracking: (r.label as string | null) ?? (r.session_key as string | null) ?? 'unknown',
    tester_id: r.tester_id as number | null,
    tester_name: r.tester_name as string | null,
    serial_count: Number(r.serial_count ?? 0),
    latest_event_at: r.latest_event_at as string | null,
    sku_summary: r.sku_summary as string | null,
  }));
}

export async function getTechSessionDetail(
  session: string,
  filters: AuditLogFilters,
): Promise<TechSessionDetail | null> {
  // ── 1. Resolve the session anchor ───────────────────────────────────────
  // Primary: a carrier tracking number → shipment_id (legacy / standalone tech
  // sessions). Fallback: a Zoho PO id → its receiving_lines — the "Line under
  // PO" anchor — so testing that arrived through receiving is reachable even
  // when no tracking was ever attached (testing verdicts leave shipment_id
  // NULL on tech_serial_numbers; only receiving_line_id is set).
  let shipmentId: number | null = null;
  let canonicalTracking = session;
  let anchorLineIds: number[] = [];

  const trackingRes = await pool.query(
    `SELECT id, tracking_number_raw
       FROM shipping_tracking_numbers
       WHERE tracking_number_raw = $1
          OR tracking_number_normalized = $1
          OR tracking_number_normalized = UPPER(REGEXP_REPLACE($1, '[^A-Za-z0-9]', '', 'g'))
       LIMIT 1`,
    [session],
  );
  if (trackingRes.rows.length > 0) {
    shipmentId = trackingRes.rows[0].id as number;
    canonicalTracking = trackingRes.rows[0].tracking_number_raw as string;
  } else {
    const poRes = await pool.query(
      `SELECT id FROM receiving_lines WHERE zoho_purchaseorder_id = $1`,
      [session],
    );
    if (poRes.rows.length === 0) return null;
    anchorLineIds = poRes.rows.map((r: Record<string, unknown>) => r.id as number);
  }

  // ── 2. Gather the tech_serial_numbers rows for the session ───────────────
  const serialsRes =
    shipmentId != null
      ? await pool.query(
          `SELECT tsn.id,
                  tsn.serial_number,
                  tsn.serial_type,
                  tsn.created_at AS test_date_time,
                  tsn.tested_by AS tester_id,
                  tsn.receiving_line_id,
                  tsn.serial_unit_id,
                  s.name AS tester_name,
                  sk.static_sku AS sku
             FROM tech_serial_numbers tsn
             LEFT JOIN staff s ON s.id = tsn.tested_by
             LEFT JOIN sku sk ON sk.id = tsn.source_sku_id
            WHERE tsn.shipment_id = $1
            ORDER BY tsn.created_at DESC NULLS LAST, tsn.id DESC`,
          [shipmentId],
        )
      : await pool.query(
          `SELECT tsn.id,
                  tsn.serial_number,
                  tsn.serial_type,
                  tsn.created_at AS test_date_time,
                  tsn.tested_by AS tester_id,
                  tsn.receiving_line_id,
                  tsn.serial_unit_id,
                  s.name AS tester_name,
                  sk.static_sku AS sku
             FROM tech_serial_numbers tsn
             LEFT JOIN staff s ON s.id = tsn.tested_by
             LEFT JOIN sku sk ON sk.id = tsn.source_sku_id
            WHERE tsn.receiving_line_id = ANY($1::int[])
            ORDER BY tsn.created_at DESC NULLS LAST, tsn.id DESC`,
          [anchorLineIds],
        );

  const serialIds = serialsRes.rows.map((r: Record<string, unknown>) => r.id as number);

  // Collect the receiving-line + serial-unit anchors this session spans. These
  // are the keys we use to pull the unified inventory_events spine (RECEIVED,
  // TEST_*, PUTAWAY, …) so the timeline shows receiving AND testing together.
  const serialUnitIds = new Set<number>();
  const lineIds = new Set<number>(anchorLineIds);
  for (const r of serialsRes.rows as Record<string, unknown>[]) {
    if (r.serial_unit_id != null) serialUnitIds.add(r.serial_unit_id as number);
    if (r.receiving_line_id != null) lineIds.add(r.receiving_line_id as number);
  }

  // Expand to lines recorded on the serial_units themselves — covers verdicts
  // whose tech_serial_numbers row predates the receiving_line_id backfill, or
  // line-less orphan serials reached via shipment.
  if (serialUnitIds.size > 0) {
    const suRes = await pool.query(
      `SELECT id, origin_receiving_line_id
         FROM serial_units
        WHERE id = ANY($1::int[])`,
      [Array.from(serialUnitIds)],
    );
    for (const r of suRes.rows as Record<string, unknown>[]) {
      if (r.origin_receiving_line_id != null) lineIds.add(r.origin_receiving_line_id as number);
    }
  }

  const salParams: unknown[] = [serialIds.length > 0 ? serialIds : [-1]];
  const salWhere: string[] = [`sal.tech_serial_number_id = ANY($1::int[])`];
  if (filters.staffId != null) {
    salParams.push(filters.staffId);
    salWhere.push(`sal.staff_id = $${salParams.length}`);
  }
  const salRes = await pool.query(
    `SELECT sal.id,
            sal.created_at,
            sal.activity_type,
            sal.staff_id,
            s.name AS actor_name,
            sal.station,
            sal.notes,
            sal.scan_ref,
            sal.fnsku,
            sal.metadata,
            tsn.serial_number,
            sk.static_sku AS sku
       FROM station_activity_logs sal
       LEFT JOIN staff s ON s.id = sal.staff_id
       LEFT JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id
       LEFT JOIN sku sk ON sk.id = tsn.source_sku_id
       WHERE ${salWhere.join(' AND ')}
       ORDER BY sal.created_at ASC`,
    salParams,
  );

  const auditParams: unknown[] = [
    serialIds.length > 0 ? serialIds.map((id: number) => String(id)) : ['-1'],
    salRes.rows.length > 0 ? salRes.rows.map((r: Record<string, unknown>) => r.id) : [-1],
  ];
  const auditWhere = [
    `(
       (al.entity_type = 'TECH_SERIAL' AND al.entity_id = ANY($1::text[]))
       OR al.station_activity_log_id = ANY($2::bigint[])
     )`,
  ];
  if (filters.staffId != null) {
    auditParams.push(filters.staffId);
    auditWhere.push(`al.actor_staff_id = $${auditParams.length}`);
  }
  const auditRes = await pool.query(
    `SELECT al.id,
            al.created_at,
            al.action,
            al.source,
            al.actor_staff_id,
            s.name AS actor_name,
            al.actor_role,
            al.entity_type,
            al.entity_id,
            al.station_activity_log_id,
            al.metadata
       FROM audit_logs al
       LEFT JOIN staff s ON s.id = al.actor_staff_id
       WHERE ${auditWhere.join(' AND ')}
       ORDER BY al.created_at ASC`,
    auditParams,
  );

  // ── Unified lifecycle spine (inventory_events) ───────────────────────────
  // The testing verdict path writes inventory_events (TEST_PASS/TEST_FAIL/
  // TEST_START) tagged with receiving_line_id + serial_unit_id, and receiving
  // writes RECEIVED there too. Anchoring on those keys surfaces the full
  // cross-station timeline that the shipment-only query used to miss.
  const invRows = await readInventorySpine({
    lineIds: Array.from(lineIds),
    serialUnitIds: Array.from(serialUnitIds),
    staffId: filters.staffId,
    order: 'asc',
  });

  // Serials that already have a first-class TEST_* lifecycle event. For these
  // we suppress the synthetic SERIAL_TESTED row so the verdict isn't shown
  // twice — inventory_events is the source of truth for testing (carries the
  // prev→next status transition and verdict payload).
  const serialsWithTestEvent = new Set<string>();
  for (const r of invRows) {
    if (r.event_type.startsWith('TEST') && r.serial_number) {
      serialsWithTestEvent.add(r.serial_number.toUpperCase());
    }
  }

  const events: TechEvent[] = [];

  for (const r of serialsRes.rows) {
    if (!r.test_date_time) continue;
    if (
      r.serial_number &&
      serialsWithTestEvent.has(String(r.serial_number).toUpperCase())
    ) {
      continue;
    }
    events.push({
      id: `tsn:${r.id}`,
      occurred_at: r.test_date_time as string,
      source: 'tech_serial_number',
      kind: 'SERIAL_TESTED',
      actor_staff_id: r.tester_id as number | null,
      actor_name: r.tester_name as string | null,
      station: null,
      serial_number: r.serial_number as string,
      sku: r.sku as string | null,
      notes: null,
      before: null,
      after: null,
      detail: { serial_type: r.serial_type, tech_serial_number_id: r.id },
    });
  }

  for (const r of invRows) {
    events.push({
      id: `inv:${r.id}`,
      occurred_at: r.occurred_at,
      source: 'inventory_event',
      kind: r.event_type,
      actor_staff_id: r.actor_staff_id,
      actor_name: r.actor_name,
      station: r.station,
      serial_number: r.serial_number,
      sku: r.sku,
      notes: r.notes,
      before: r.prev_status ? { status: r.prev_status } : null,
      after: r.next_status ? { status: r.next_status } : null,
      detail: r.payload ?? {},
    });
  }

  for (const r of salRes.rows) {
    events.push({
      id: `sal:${r.id}`,
      occurred_at: r.created_at as string,
      source: 'station_activity_log',
      kind: r.activity_type as string,
      actor_staff_id: r.staff_id as number | null,
      actor_name: r.actor_name as string | null,
      station: r.station as string | null,
      serial_number: r.serial_number as string | null,
      sku: r.sku as string | null,
      notes: r.notes as string | null,
      before: null,
      after: null,
      detail: {
        scan_ref: r.scan_ref,
        fnsku: r.fnsku,
        metadata: r.metadata,
      },
    });
  }

  for (const r of auditRes.rows) {
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    events.push({
      id: `audit:${r.id}`,
      occurred_at: r.created_at as string,
      source: 'audit_log',
      kind: r.action as string,
      actor_staff_id: r.actor_staff_id as number | null,
      actor_name: r.actor_name as string | null,
      station: null,
      serial_number: null,
      sku: null,
      notes: null,
      before: (metadata.before as Record<string, unknown>) ?? null,
      after: (metadata.after as Record<string, unknown>) ?? null,
      detail: {
        source: r.source,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        station_activity_log_id: r.station_activity_log_id,
        metadata,
      },
    });
  }

  const startMs = filters.range.start ? new Date(filters.range.start).getTime() : null;
  const endMs = filters.range.end ? new Date(filters.range.end).getTime() : null;
  const filteredEvents = events.filter((ev) => {
    if (!ev.occurred_at) return true;
    const t = new Date(ev.occurred_at).getTime();
    if (startMs != null && t < startMs) return false;
    if (endMs != null && t > endMs) return false;
    return true;
  });

  filteredEvents.sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );

  // SKU summary stitched from whatever the session touched — the serials' own
  // SKU plus any SKU stamped on the lifecycle events (covers receiving lines
  // whose tech_serial_numbers row has no source_sku_id).
  const skuSet = new Set<string>();
  for (const r of serialsRes.rows as Record<string, unknown>[]) {
    if (r.sku) skuSet.add(String(r.sku));
  }
  for (const r of invRows) {
    if (r.sku) skuSet.add(r.sku);
  }

  return {
    tracking: canonicalTracking,
    serials: serialsRes.rows.map((r: Record<string, unknown>) => ({
      id: r.id as number,
      serial_number: r.serial_number as string,
      serial_type: r.serial_type as string | null,
      test_date_time: r.test_date_time as string | null,
      tester_id: r.tester_id as number | null,
      tester_name: r.tester_name as string | null,
      sku: r.sku as string | null,
    })),
    events: filteredEvents,
    sku_summary: skuSet.size > 0 ? Array.from(skuSet).join(', ') : null,
  };
}
