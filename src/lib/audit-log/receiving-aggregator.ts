/**
 * Read-only aggregator that stitches a complete receiving timeline together
 * from every source the system already records into:
 *
 *   • receiving               — carton-level (received_at/by, unboxed_at/by, QA, disposition)
 *   • receiving_lines         — per-SKU operational rows
 *   • receiving_lines.disposition_audit  — JSONB history of disposition changes
 *   • inventory_events        — lifecycle (RECEIVED, TEST_*, PUTAWAY, …) tagged with receiving_id / receiving_line_id
 *   • audit_logs              — field-level before/after diffs (when instrumented)
 *   • photos                  — entity_type='RECEIVING'
 *   • serial_units            — serials scanned against a line
 *   • staff                   — actor names
 *   • replenishment_requests  — zoho_po_number + vendor (joined by zoho_po_id)
 *
 * One PO can span multiple cartons (and one carton can hold lines from
 * multiple POs) so we anchor on `receiving_lines.zoho_purchaseorder_id` and
 * pull cartons through the line→receiving FK.
 */

import 'server-only';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { readInventorySpine } from './inventory-spine';

export interface AuditEvent {
  /** Stable synthetic id: `${source}:${id}` so React keys stay unique. */
  id: string;
  occurred_at: string;
  source: 'carton' | 'line' | 'inventory_event' | 'audit_log' | 'disposition' | 'photo' | 'serial';
  /** Short, human-readable verb. Examples: CARTON_RECEIVED, LINE_UNBOXED, TEST_PASS, PHOTO_ADDED. */
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  receiving_id: number | null;
  receiving_line_id: number | null;
  serial_unit_id: number | null;
  serial_number: string | null;
  bin_id: number | null;
  bin_name: string | null;
  sku: string | null;
  notes: string | null;
  /** Optional before/after diffs (when audit_logs has them). */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Free-form bag for everything else the UI may want to render. */
  detail: Record<string, unknown>;
}

export interface AuditPOSummary {
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  line_count: number;
  carton_count: number;
  quantity_expected: number;
  quantity_received: number;
  workflow_counts: Record<string, number>;
  latest_event_at: string | null;
  last_actor_name: string | null;
}

export interface AuditCarton {
  id: number;
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
  received_at: string | null;
  received_by: number | null;
  received_by_name: string | null;
  unboxed_at: string | null;
  unboxed_by: number | null;
  unboxed_by_name: string | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  is_return: boolean;
  return_platform: string | null;
  return_reason: string | null;
  target_channel: string | null;
  assigned_tech_id: number | null;
  assigned_tech_name: string | null;
  zoho_purchase_receive_id: string | null;
  support_notes: string | null;
  photos: AuditPhoto[];
}

export interface AuditPhoto {
  id: number;
  url: string;
  photo_type: string | null;
  taken_at: string;
  taken_by: number | null;
  taken_by_name: string | null;
}

export interface AuditSerial {
  id: number;
  serial_number: string;
  current_status: string | null;
  current_location: string | null;
  received_at: string | null;
  received_by: number | null;
  received_by_name: string | null;
}

export interface AuditLine {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
  zoho_item_id: string;
  zoho_line_item_id: string | null;
  zoho_purchase_receive_id: string | null;
  quantity_expected: number | null;
  quantity_received: number | null;
  workflow_status: string;
  qa_status: string;
  disposition_code: string;
  condition_grade: string;
  disposition_final: string | null;
  needs_test: boolean;
  assigned_tech_id: number | null;
  assigned_tech_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  zoho_synced_at: string | null;
  serials: AuditSerial[];
}

export interface AuditPODetail {
  po: {
    po_id: string;
    po_number: string | null;
    vendor_name: string | null;
  };
  cartons: AuditCarton[];
  lines: AuditLine[];
  events: AuditEvent[];
}

// ── Internal row types ─────────────────────────────────────────────────────

interface ReceivingRow {
  id: number;
  receiving_tracking_number: string | null;
  carrier: string | null;
  created_at: string;
  received_at: string | null;
  received_by: number | null;
  unboxed_at: string | null;
  unboxed_by: number | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  is_return: boolean;
  return_platform: string | null;
  return_reason: string | null;
  target_channel: string | null;
  assigned_tech_id: number | null;
  zoho_purchase_receive_id: string | null;
  support_notes: string | null;
  updated_at: string;
}

interface LineRow {
  id: number;
  receiving_id: number | null;
  zoho_item_id: string;
  zoho_line_item_id: string | null;
  zoho_purchase_receive_id: string | null;
  zoho_purchaseorder_id: string | null;
  item_name: string | null;
  sku: string | null;
  quantity: number | null;
  quantity_received: number | null;
  quantity_expected: number | null;
  workflow_status: string;
  qa_status: string;
  disposition_code: string;
  condition_grade: string;
  disposition_audit: unknown;
  disposition_final: string | null;
  needs_test: boolean;
  assigned_tech_id: number | null;
  notes: string | null;
  zoho_sync_source: string | null;
  zoho_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface InventoryEventRow {
  id: number;
  occurred_at: string;
  event_type: string;
  actor_staff_id: number | null;
  station: string | null;
  receiving_id: number | null;
  receiving_line_id: number | null;
  serial_unit_id: number | null;
  sku: string | null;
  bin_id: number | null;
  prev_bin_id: number | null;
  prev_status: string | null;
  next_status: string | null;
  notes: string | null;
  payload: Record<string, unknown>;
}

interface AuditLogRow {
  id: number;
  created_at: string;
  actor_staff_id: number | null;
  actor_role: string | null;
  source: string;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address: string | null;
  user_agent: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

interface PhotoRow {
  id: number;
  entity_type: string;
  entity_id: number;
  url: string;
  taken_by_staff_id: number | null;
  photo_type: string | null;
  created_at: string;
}

interface SerialRow {
  id: number;
  serial_number: string;
  receiving_line_id: number | null;
  current_status: string | null;
  current_location: string | null;
  received_at: string | null;
  received_by: number | null;
}

// ── Public reads ───────────────────────────────────────────────────────────

export interface ListPOsOpts {
  limit?: number;
  offset?: number;
  search?: string | null;
}

/**
 * Return the most recently-touched POs (anchored by max(receiving_lines.updated_at)).
 * `search` matches PO id, PO number, sku, or item name (case-insensitive).
 */
export async function listReceivingAuditPOs(
  opts: ListPOsOpts = {},
  orgId?: OrgId,
): Promise<AuditPOSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const search = opts.search?.trim() ?? '';

  const params: unknown[] = [];
  let searchClause = '';

  // When orgId is present, allocate $1 for it and weave organization_id
  // predicates into every read against a tenant table; string-key joins
  // (rr.zoho_po_id = rl.zoho_purchaseorder_id) also get an org-equality
  // guard. When omitted, the SQL/params stay byte-identical to before.
  let orgIdx = '';
  let orgMatchingFilter = '';
  let orgPoAggFilter = '';
  let orgWfFilter = '';
  let orgSubqueryFilter = '';
  let orgRrJoin = '';
  if (orgId) {
    params.push(orgId);
    orgIdx = `$${params.length}`;
    orgMatchingFilter = `AND rl.organization_id = ${orgIdx}
      AND (rr.zoho_po_id IS NULL OR rr.organization_id = rl.organization_id)`;
    orgPoAggFilter = `AND rl.organization_id = ${orgIdx}`;
    orgWfFilter = `AND organization_id = ${orgIdx}`;
    orgSubqueryFilter = `AND rl2.organization_id = ${orgIdx}`;
    orgRrJoin = `AND rr.organization_id = ${orgIdx}`;
  }

  if (search) {
    params.push(`%${search}%`);
    const pIdx = `$${params.length}`;
    searchClause = `AND (rl.zoho_purchaseorder_id ILIKE ${pIdx}
                     OR rl.sku ILIKE ${pIdx}
                     OR rl.item_name ILIKE ${pIdx}
                     OR rr.zoho_po_number ILIKE ${pIdx})`;
  }

  params.push(limit, offset);
  const limitIdx = `$${params.length - 1}`;
  const offsetIdx = `$${params.length}`;

  const sql = `
    WITH matching_pos AS (
      SELECT DISTINCT rl.zoho_purchaseorder_id AS po_id
      FROM receiving_lines rl
      LEFT JOIN replenishment_requests rr ON rr.zoho_po_id = rl.zoho_purchaseorder_id
      WHERE rl.zoho_purchaseorder_id IS NOT NULL
      ${orgMatchingFilter}
      ${searchClause}
    ),
    po_agg AS (
      SELECT
        rl.zoho_purchaseorder_id AS po_id,
        COUNT(*)::int AS line_count,
        COUNT(DISTINCT rl.receiving_id) FILTER (WHERE rl.receiving_id IS NOT NULL)::int AS carton_count,
        COALESCE(SUM(rl.quantity_expected), 0)::int AS quantity_expected,
        COALESCE(SUM(rl.quantity_received), 0)::int AS quantity_received,
        MAX(rl.updated_at) AS latest_event_at
      FROM receiving_lines rl
      WHERE rl.zoho_purchaseorder_id IN (SELECT po_id FROM matching_pos)
      ${orgPoAggFilter}
      GROUP BY rl.zoho_purchaseorder_id
    ),
    wf AS (
      SELECT zoho_purchaseorder_id, workflow_status, COUNT(*)::int AS cnt
      FROM receiving_lines
      WHERE zoho_purchaseorder_id IN (SELECT po_id FROM matching_pos)
      ${orgWfFilter}
      GROUP BY zoho_purchaseorder_id, workflow_status
    ),
    wf_agg AS (
      SELECT zoho_purchaseorder_id,
             jsonb_object_agg(workflow_status, cnt) AS workflow_counts
      FROM wf
      GROUP BY zoho_purchaseorder_id
    )
    SELECT
      po.po_id,
      rr.zoho_po_number AS po_number,
      rr.vendor_name,
      po.line_count,
      po.carton_count,
      po.quantity_expected,
      po.quantity_received,
      COALESCE(wf_agg.workflow_counts, '{}'::jsonb) AS workflow_counts,
      po.latest_event_at,
      (
        SELECT s.name FROM receiving_lines rl2
        LEFT JOIN receiving r2 ON r2.id = rl2.receiving_id
        LEFT JOIN staff s ON s.id = r2.received_by
        WHERE rl2.zoho_purchaseorder_id = po.po_id
        ${orgSubqueryFilter}
        ORDER BY rl2.updated_at DESC NULLS LAST
        LIMIT 1
      ) AS last_actor_name
    FROM po_agg po
    LEFT JOIN wf_agg ON wf_agg.zoho_purchaseorder_id = po.po_id
    LEFT JOIN replenishment_requests rr ON rr.zoho_po_id = po.po_id ${orgRrJoin}
    ORDER BY po.latest_event_at DESC NULLS LAST
    LIMIT ${limitIdx} OFFSET ${offsetIdx}
  `;

  const r = orgId ? await tenantQuery(orgId, sql, params) : await pool.query(sql, params);
  return r.rows.map((row: Record<string, unknown>) => ({
    po_id: String(row.po_id ?? ''),
    po_number: (row.po_number as string | null) ?? null,
    vendor_name: (row.vendor_name as string | null) ?? null,
    line_count: Number(row.line_count ?? 0),
    carton_count: Number(row.carton_count ?? 0),
    quantity_expected: Number(row.quantity_expected ?? 0),
    quantity_received: Number(row.quantity_received ?? 0),
    workflow_counts: (row.workflow_counts as Record<string, number>) ?? {},
    latest_event_at: (row.latest_event_at as string | null) ?? null,
    last_actor_name: (row.last_actor_name as string | null) ?? null,
  }));
}

/**
 * Full timeline for one PO: cartons + lines + every event we can derive,
 * sorted newest-first.
 */
export async function getReceivingAuditPO(
  poId: string,
  orgId?: OrgId,
): Promise<AuditPODetail | null> {
  if (!poId) return null;

  const linesRes = orgId
    ? await tenantQuery(
        orgId,
        `SELECT * FROM receiving_lines WHERE zoho_purchaseorder_id = $1 AND organization_id = $2 ORDER BY id`,
        [poId, orgId],
      )
    : await pool.query(
        `SELECT * FROM receiving_lines WHERE zoho_purchaseorder_id = $1 ORDER BY id`,
        [poId],
      );
  const lineRows = linesRes.rows as LineRow[];
  if (lineRows.length === 0) return null;

  const lineIds = lineRows.map((l) => l.id);
  const cartonIds = Array.from(
    new Set(lineRows.map((l) => l.receiving_id).filter((v): v is number => v != null)),
  );

  const [cartonsResRaw, eventsResRaw, auditLogsResRaw, photosResRaw, serialsResRaw, vendorResRaw] =
    await Promise.all([
      cartonIds.length > 0
        ? orgId
          ? tenantQuery(
              orgId,
              `SELECT * FROM receiving WHERE id = ANY($1::int[]) AND organization_id = $2 ORDER BY id`,
              [cartonIds, orgId],
            )
          : pool.query(
              `SELECT * FROM receiving WHERE id = ANY($1::int[]) ORDER BY id`,
              [cartonIds],
            )
        : Promise.resolve({ rows: [] }),

      // Lifecycle spine via the shared reader (Phase 0). Keyed on this PO's
      // lines + cartons; receiving does its own staff/bin/serial enrichment
      // from batched maps below, so the reader's joined fields are ignored here.
      // NOTE: readInventorySpine does not yet accept an orgId param (object
      // opts has no orgId field), so we cannot thread orgId through here. The
      // lineIds/cartonIds are already org-scoped (derived from the org-filtered
      // lineRows), so results stay within this org's rows; once the sibling
      // gains an orgId opt this should be passed through.
      readInventorySpine({
        lineIds,
        cartonIds,
        order: 'desc',
        limit: 1000,
      }),

      orgId
        ? tenantQuery(
            orgId,
            `SELECT * FROM audit_logs
              WHERE organization_id = $4
                AND ((entity_type = 'receiving_line' AND entity_id = ANY($1::text[]))
                  OR (entity_type = 'receiving'      AND entity_id = ANY($2::text[]))
                  OR (entity_type = 'purchase_order' AND entity_id = $3))
              ORDER BY created_at DESC, id DESC
              LIMIT 1000`,
            [lineIds.map(String), cartonIds.map(String), poId, orgId],
          )
        : pool.query(
            `SELECT * FROM audit_logs
              WHERE (entity_type = 'receiving_line' AND entity_id = ANY($1::text[]))
                 OR (entity_type = 'receiving'      AND entity_id = ANY($2::text[]))
                 OR (entity_type = 'purchase_order' AND entity_id = $3)
              ORDER BY created_at DESC, id DESC
              LIMIT 1000`,
            [lineIds.map(String), cartonIds.map(String), poId],
          ),

      cartonIds.length > 0
        ? orgId
          ? tenantQuery(
              orgId,
              `SELECT * FROM photos
                WHERE entity_type = 'RECEIVING' AND entity_id = ANY($1::int[])
                  AND organization_id = $2
                ORDER BY created_at DESC, id DESC`,
              [cartonIds, orgId],
            )
          : pool.query(
              `SELECT * FROM photos
                WHERE entity_type = 'RECEIVING' AND entity_id = ANY($1::int[])
                ORDER BY created_at DESC, id DESC`,
              [cartonIds],
            )
        : Promise.resolve({ rows: [] }),

      (orgId
        ? tenantQuery(
            orgId,
            `SELECT id, serial_number, receiving_line_id, current_status, current_location,
                    received_at, received_by
               FROM serial_units
              WHERE receiving_line_id = ANY($1::int[]) AND organization_id = $2
              ORDER BY id`,
            [lineIds, orgId],
          )
        : pool.query(
            `SELECT id, serial_number, receiving_line_id, current_status, current_location,
                    received_at, received_by
               FROM serial_units
              WHERE receiving_line_id = ANY($1::int[])
              ORDER BY id`,
            [lineIds],
          )
      ).catch(() => ({ rows: [] })),

      orgId
        ? tenantQuery(
            orgId,
            `SELECT zoho_po_number, vendor_name
               FROM replenishment_requests
              WHERE zoho_po_id = $1 AND organization_id = $2
              LIMIT 1`,
            [poId, orgId],
          )
        : pool.query(
            `SELECT zoho_po_number, vendor_name
               FROM replenishment_requests
              WHERE zoho_po_id = $1
              LIMIT 1`,
            [poId],
          ),
    ]);

  const cartonsRes = { rows: cartonsResRaw.rows as ReceivingRow[] };
  const eventsRes = { rows: eventsResRaw as InventoryEventRow[] };
  const auditLogsRes = { rows: auditLogsResRaw.rows as AuditLogRow[] };
  const photosRes = { rows: photosResRaw.rows as PhotoRow[] };
  const serialsRes = { rows: serialsResRaw.rows as SerialRow[] };
  const vendorRes = {
    rows: vendorResRaw.rows as Array<{ zoho_po_number: string | null; vendor_name: string | null }>,
  };

  // ── Build staff/bin lookup maps in one batched fetch ────────────────────
  const staffIds = new Set<number>();
  const binIds = new Set<number>();
  const serialUnitIds = new Set<number>();

  const addStaff = (v: number | null | undefined) => {
    if (typeof v === 'number') staffIds.add(v);
  };
  const addBin = (v: number | null | undefined) => {
    if (typeof v === 'number') binIds.add(v);
  };

  for (const c of cartonsRes.rows) {
    addStaff(c.received_by);
    addStaff(c.unboxed_by);
    addStaff(c.assigned_tech_id);
  }
  for (const l of lineRows) addStaff(l.assigned_tech_id);
  for (const e of eventsRes.rows) {
    addStaff(e.actor_staff_id);
    addBin(e.bin_id);
    addBin(e.prev_bin_id);
    if (e.serial_unit_id != null) serialUnitIds.add(e.serial_unit_id);
  }
  for (const al of auditLogsRes.rows) addStaff(al.actor_staff_id);
  for (const p of photosRes.rows) addStaff(p.taken_by_staff_id);
  for (const s of serialsRes.rows) addStaff(s.received_by);

  const [staffMap, binMap, extraSerialMap] = await Promise.all([
    fetchStaffNames(Array.from(staffIds), orgId),
    fetchBinNames(Array.from(binIds), orgId),
    fetchSerialNumbers(Array.from(serialUnitIds), orgId),
  ]);

  const serialByLine = new Map<number, AuditSerial[]>();
  for (const s of serialsRes.rows) {
    if (s.receiving_line_id == null) continue;
    const list = serialByLine.get(s.receiving_line_id) ?? [];
    list.push({
      id: s.id,
      serial_number: s.serial_number,
      current_status: s.current_status,
      current_location: s.current_location,
      received_at: s.received_at,
      received_by: s.received_by,
      received_by_name: s.received_by != null ? staffMap.get(s.received_by) ?? null : null,
    });
    serialByLine.set(s.receiving_line_id, list);
  }

  // Serial id → serial_number for inventory_events that reference a serial
  // outside our receiving_lines scope.
  const serialIdToNumber = new Map<number, string>();
  for (const s of serialsRes.rows) serialIdToNumber.set(s.id, s.serial_number);
  for (const [id, sn] of extraSerialMap) {
    if (!serialIdToNumber.has(id)) serialIdToNumber.set(id, sn);
  }

  const photosByCarton = new Map<number, AuditPhoto[]>();
  for (const p of photosRes.rows) {
    const list = photosByCarton.get(p.entity_id) ?? [];
    list.push({
      id: p.id,
      url: p.url,
      photo_type: p.photo_type,
      taken_at: p.created_at,
      taken_by: p.taken_by_staff_id,
      taken_by_name: p.taken_by_staff_id != null ? staffMap.get(p.taken_by_staff_id) ?? null : null,
    });
    photosByCarton.set(p.entity_id, list);
  }

  // ── Build event stream ──────────────────────────────────────────────────
  const events: AuditEvent[] = [];
  const skuByLineId = new Map<number, string | null>(lineRows.map((l) => [l.id, l.sku]));

  for (const c of cartonsRes.rows) {
    events.push({
      id: `carton-created:${c.id}`,
      occurred_at: c.created_at,
      source: 'carton',
      kind: 'CARTON_CREATED',
      actor_staff_id: null,
      actor_name: null,
      station: null,
      receiving_id: c.id,
      receiving_line_id: null,
      serial_unit_id: null,
      serial_number: null,
      bin_id: null,
      bin_name: null,
      sku: null,
      notes: null,
      before: null,
      after: null,
      detail: {
        tracking_number: c.receiving_tracking_number,
        carrier: c.carrier,
      },
    });

    if (c.received_at) {
      events.push({
        id: `carton-received:${c.id}`,
        occurred_at: c.received_at,
        source: 'carton',
        kind: 'CARTON_RECEIVED',
        actor_staff_id: c.received_by,
        actor_name: c.received_by != null ? staffMap.get(c.received_by) ?? null : null,
        station: 'RECEIVING',
        receiving_id: c.id,
        receiving_line_id: null,
        serial_unit_id: null,
        serial_number: null,
        bin_id: null,
        bin_name: null,
        sku: null,
        notes: null,
        before: null,
        after: null,
        detail: {
          tracking_number: c.receiving_tracking_number,
          carrier: c.carrier,
          is_return: c.is_return,
          return_platform: c.return_platform,
          return_reason: c.return_reason,
        },
      });
    }

    if (c.unboxed_at) {
      events.push({
        id: `carton-unboxed:${c.id}`,
        occurred_at: c.unboxed_at,
        source: 'carton',
        kind: 'CARTON_UNBOXED',
        actor_staff_id: c.unboxed_by,
        actor_name: c.unboxed_by != null ? staffMap.get(c.unboxed_by) ?? null : null,
        station: 'RECEIVING',
        receiving_id: c.id,
        receiving_line_id: null,
        serial_unit_id: null,
        serial_number: null,
        bin_id: null,
        bin_name: null,
        sku: null,
        notes: c.support_notes,
        before: null,
        after: null,
        detail: {
          qa_status: c.qa_status,
          disposition_code: c.disposition_code,
          condition_grade: c.condition_grade,
        },
      });
    }
  }

  for (const l of lineRows) {
    events.push({
      id: `line-created:${l.id}`,
      occurred_at: l.created_at,
      source: 'line',
      kind: 'LINE_CREATED',
      actor_staff_id: null,
      actor_name: null,
      station: l.zoho_sync_source ? 'SYSTEM' : null,
      receiving_id: l.receiving_id,
      receiving_line_id: l.id,
      serial_unit_id: null,
      serial_number: null,
      bin_id: null,
      bin_name: null,
      sku: l.sku,
      notes: null,
      before: null,
      after: null,
      detail: {
        item_name: l.item_name,
        quantity_expected: l.quantity_expected,
        zoho_line_item_id: l.zoho_line_item_id,
      },
    });

    // Disposition audit JSONB (array of entries with shape we don't fully
    // know — pass it through verbatim).
    if (Array.isArray(l.disposition_audit)) {
      for (let i = 0; i < l.disposition_audit.length; i++) {
        const raw = l.disposition_audit[i] as Record<string, unknown> | null;
        if (!raw || typeof raw !== 'object') continue;
        const at = pickString(raw, ['at', 'occurred_at', 'timestamp', 'created_at']);
        const actorId = pickNumber(raw, ['actor_staff_id', 'staff_id', 'by']);
        const before = pickObject(raw, ['from', 'before']);
        const after = pickObject(raw, ['to', 'after']);
        events.push({
          id: `disposition:${l.id}:${i}`,
          occurred_at: at ?? l.updated_at,
          source: 'disposition',
          kind: 'DISPOSITION_CHANGED',
          actor_staff_id: actorId,
          actor_name: actorId != null ? staffMap.get(actorId) ?? null : null,
          station: pickString(raw, ['station']),
          receiving_id: l.receiving_id,
          receiving_line_id: l.id,
          serial_unit_id: null,
          serial_number: null,
          bin_id: null,
          bin_name: null,
          sku: l.sku,
          notes: pickString(raw, ['note', 'notes', 'reason']),
          before,
          after,
          detail: raw,
        });
      }
    }
  }

  for (const e of eventsRes.rows) {
    events.push({
      id: `inv:${e.id}`,
      occurred_at: e.occurred_at,
      source: 'inventory_event',
      kind: e.event_type,
      actor_staff_id: e.actor_staff_id,
      actor_name: e.actor_staff_id != null ? staffMap.get(e.actor_staff_id) ?? null : null,
      station: e.station,
      receiving_id: e.receiving_id,
      receiving_line_id: e.receiving_line_id,
      serial_unit_id: e.serial_unit_id,
      serial_number: e.serial_unit_id != null ? serialIdToNumber.get(e.serial_unit_id) ?? null : null,
      bin_id: e.bin_id,
      bin_name: e.bin_id != null ? binMap.get(e.bin_id) ?? null : null,
      sku: e.sku ?? (e.receiving_line_id != null ? skuByLineId.get(e.receiving_line_id) ?? null : null),
      notes: e.notes,
      before: e.prev_status ? { status: e.prev_status } : null,
      after: e.next_status ? { status: e.next_status } : null,
      detail: e.payload ?? {},
    });
  }

  for (const al of auditLogsRes.rows) {
    const targetCarton = al.entity_type === 'receiving' ? Number(al.entity_id) : null;
    const targetLine = al.entity_type === 'receiving_line' ? Number(al.entity_id) : null;
    events.push({
      id: `audit:${al.id}`,
      occurred_at: al.created_at,
      source: 'audit_log',
      kind: al.action,
      actor_staff_id: al.actor_staff_id,
      actor_name: al.actor_staff_id != null ? staffMap.get(al.actor_staff_id) ?? null : null,
      station: al.source,
      receiving_id: targetCarton,
      receiving_line_id: targetLine,
      serial_unit_id: null,
      serial_number: null,
      bin_id: null,
      bin_name: null,
      sku: targetLine != null ? skuByLineId.get(targetLine) ?? null : null,
      notes: null,
      before: al.before_data,
      after: al.after_data,
      detail: {
        actor_role: al.actor_role,
        ip_address: al.ip_address,
        user_agent: al.user_agent,
        ...(al.metadata ?? {}),
      },
    });
  }

  for (const p of photosRes.rows) {
    events.push({
      id: `photo:${p.id}`,
      occurred_at: p.created_at,
      source: 'photo',
      kind: 'PHOTO_ADDED',
      actor_staff_id: p.taken_by_staff_id,
      actor_name: p.taken_by_staff_id != null ? staffMap.get(p.taken_by_staff_id) ?? null : null,
      station: null,
      receiving_id: p.entity_id,
      receiving_line_id: null,
      serial_unit_id: null,
      serial_number: null,
      bin_id: null,
      bin_name: null,
      sku: null,
      notes: null,
      before: null,
      after: null,
      detail: {
        url: p.url,
        photo_type: p.photo_type,
      },
    });
  }

  events.sort((a, b) => {
    if (a.occurred_at === b.occurred_at) return a.id < b.id ? 1 : -1;
    return a.occurred_at < b.occurred_at ? 1 : -1;
  });

  const vendor = vendorRes.rows[0] ?? null;

  const cartons: AuditCarton[] = cartonsRes.rows.map((c) => ({
    id: c.id,
    tracking_number: c.receiving_tracking_number,
    carrier: c.carrier,
    created_at: c.created_at,
    received_at: c.received_at,
    received_by: c.received_by,
    received_by_name: c.received_by != null ? staffMap.get(c.received_by) ?? null : null,
    unboxed_at: c.unboxed_at,
    unboxed_by: c.unboxed_by,
    unboxed_by_name: c.unboxed_by != null ? staffMap.get(c.unboxed_by) ?? null : null,
    qa_status: c.qa_status,
    disposition_code: c.disposition_code,
    condition_grade: c.condition_grade,
    is_return: c.is_return,
    return_platform: c.return_platform,
    return_reason: c.return_reason,
    target_channel: c.target_channel,
    assigned_tech_id: c.assigned_tech_id,
    assigned_tech_name: c.assigned_tech_id != null ? staffMap.get(c.assigned_tech_id) ?? null : null,
    zoho_purchase_receive_id: c.zoho_purchase_receive_id,
    support_notes: c.support_notes,
    photos: photosByCarton.get(c.id) ?? [],
  }));

  const lines: AuditLine[] = lineRows.map((l) => ({
    id: l.id,
    receiving_id: l.receiving_id,
    sku: l.sku,
    item_name: l.item_name,
    zoho_item_id: l.zoho_item_id,
    zoho_line_item_id: l.zoho_line_item_id,
    zoho_purchase_receive_id: l.zoho_purchase_receive_id,
    quantity_expected: l.quantity_expected,
    quantity_received: l.quantity_received,
    workflow_status: l.workflow_status,
    qa_status: l.qa_status,
    disposition_code: l.disposition_code,
    condition_grade: l.condition_grade,
    disposition_final: l.disposition_final,
    needs_test: l.needs_test,
    assigned_tech_id: l.assigned_tech_id,
    assigned_tech_name: l.assigned_tech_id != null ? staffMap.get(l.assigned_tech_id) ?? null : null,
    notes: l.notes,
    created_at: l.created_at,
    updated_at: l.updated_at,
    zoho_synced_at: l.zoho_synced_at,
    serials: serialByLine.get(l.id) ?? [],
  }));

  return {
    po: {
      po_id: poId,
      po_number: vendor?.zoho_po_number ?? null,
      vendor_name: vendor?.vendor_name ?? null,
    },
    cartons,
    lines,
    events,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

async function fetchStaffNames(ids: number[], orgId?: OrgId): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  const r = orgId
    ? await tenantQuery(
        orgId,
        `SELECT id, name FROM staff WHERE id = ANY($1::int[]) AND organization_id = $2`,
        [ids, orgId],
      )
    : await pool.query(
        `SELECT id, name FROM staff WHERE id = ANY($1::int[])`,
        [ids],
      );
  for (const row of r.rows as Array<{ id: number; name: string }>) map.set(row.id, row.name);
  return map;
}

async function fetchBinNames(ids: number[], orgId?: OrgId): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  try {
    const r = orgId
      ? await tenantQuery(
          orgId,
          `SELECT id, name FROM locations WHERE id = ANY($1::int[]) AND organization_id = $2`,
          [ids, orgId],
        )
      : await pool.query(
          `SELECT id, name FROM locations WHERE id = ANY($1::int[])`,
          [ids],
        );
    for (const row of r.rows as Array<{ id: number; name: string }>) map.set(row.id, row.name);
  } catch {
    // locations table may not exist in some envs — degrade silently.
  }
  return map;
}

async function fetchSerialNumbers(ids: number[], orgId?: OrgId): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  try {
    const r = orgId
      ? await tenantQuery(
          orgId,
          `SELECT id, serial_number FROM serial_units WHERE id = ANY($1::int[]) AND organization_id = $2`,
          [ids, orgId],
        )
      : await pool.query(
          `SELECT id, serial_number FROM serial_units WHERE id = ANY($1::int[])`,
          [ids],
        );
    for (const row of r.rows as Array<{ id: number; serial_number: string }>) {
      map.set(row.id, row.serial_number);
    }
  } catch {
    // serial_units may not exist on older envs.
  }
  return map;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  }
  return null;
}

function pickObject(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}
