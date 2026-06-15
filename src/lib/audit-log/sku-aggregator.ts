/**
 * Read-only aggregator for the SKU audit-log section — cross-station feed
 * for a single SKU code.
 *
 * Event sources:
 *   • inventory_events                — receiving lifecycle (joined via receiving_lines.sku)
 *   • station_activity_logs (packer)  — packer_log → orders.sku for the tracking
 *   • station_activity_logs (tech)    — tech_serial_numbers.source_sku_id → sku.static_sku
 *   • audit_logs                      — entity_type='RECEIVING_LINE' rows with matching SKU
 */

import 'server-only';
import type { QueryResultRow } from 'pg';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { AuditLogFilters } from './filters';

export interface SkuSummary {
  sku: string;
  item_name: string | null;
  event_count: number;
  latest_event_at: string | null;
}

export interface SkuEvent {
  id: string;
  occurred_at: string;
  source: 'inventory_event' | 'station_activity_log' | 'audit_log';
  station: 'receiving' | 'packing' | 'tech' | 'other';
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  tracking: string | null;
  serial_number: string | null;
  notes: string | null;
  detail: Record<string, unknown>;
}

export interface SkuDetail {
  sku: string;
  item_name: string | null;
  events: SkuEvent[];
  counts: Record<'receiving' | 'packing' | 'tech' | 'other', number>;
}

interface ListOpts {
  filters: AuditLogFilters;
  search: string | null;
}

export async function listSkus(opts: ListOpts, orgId?: OrgId): Promise<SkuSummary[]> {
  const { filters, search } = opts;
  // When orgId is present we reserve $1 for the org and offset every other
  // positional parameter by one; the CTE branches gain explicit
  // `<t>.organization_id = $1` predicates so each tenant table is filtered at
  // the source. The org GUC is also set by tenantQuery as an RLS backstop.
  const params: unknown[] = [];
  const orgParamIdx = orgId ? (params.push(orgId), params.length) : 0;
  const orgPred = orgId ? `$${orgParamIdx}` : '';
  // Per-source org predicate appended into each CTE branch's WHERE.
  const salOrg = orgId ? ` AND sal.organization_id = ${orgPred}` : '';
  const plOrg = orgId ? ` AND pl.organization_id = ${orgPred}` : '';
  const oOrg = orgId ? ` AND o.organization_id = ${orgPred}` : '';
  const tsnOrg = orgId ? ` AND tsn.organization_id = ${orgPred}` : '';
  const skOrg = orgId ? ` AND sk.organization_id = ${orgPred}` : '';
  const ieOrg = orgId ? ` AND ie.organization_id = ${orgPred}` : '';
  const rlOrg = orgId ? ` AND rl.organization_id = ${orgPred}` : '';

  const clauses: string[] = [];

  if (filters.range.start) {
    params.push(filters.range.start);
    clauses.push(`occurred_at >= $${params.length}::timestamptz`);
  }
  if (filters.range.end) {
    params.push(filters.range.end);
    clauses.push(`occurred_at <= $${params.length}::timestamptz`);
  }
  if (filters.staffId != null) {
    params.push(filters.staffId);
    clauses.push(`staff_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(sku ILIKE $${params.length} OR COALESCE(item_name, '') ILIKE $${params.length})`);
  }
  const filterSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  params.push(filters.limit);
  const limitParam = `$${params.length}`;
  params.push(filters.offset);
  const offsetParam = `$${params.length}`;

  const sql = `
    WITH events AS (
      -- Packer events.
      SELECT sal.created_at AS occurred_at,
             sal.staff_id AS staff_id,
             COALESCE(o.sku, '') AS sku,
             COALESCE(o.product_title, NULL) AS item_name
        FROM station_activity_logs sal
        JOIN packer_logs pl ON pl.id = sal.packer_log_id${plOrg}
        LEFT JOIN orders o ON o.shipment_id = pl.shipment_id${oOrg}
       WHERE COALESCE(o.sku, '') <> ''${salOrg}
      UNION ALL
      -- Tech events.
      SELECT sal.created_at AS occurred_at,
             sal.staff_id AS staff_id,
             COALESCE(sk.static_sku, '') AS sku,
             NULL::text AS item_name
        FROM station_activity_logs sal
        JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id${tsnOrg}
        LEFT JOIN sku sk ON sk.id = tsn.source_sku_id${skOrg}
       WHERE COALESCE(sk.static_sku, '') <> ''${salOrg}
      UNION ALL
      -- Lifecycle spine. LEFT JOIN + COALESCE(rl.sku, ie.sku) so line-less
      -- serial/SKU events (e.g. ADMIN label prints → LABELED, which carry
      -- ie.sku but no receiving_line_id) still anchor to their SKU here.
      SELECT ie.occurred_at AS occurred_at,
             ie.actor_staff_id AS staff_id,
             COALESCE(rl.sku, ie.sku, '') AS sku,
             rl.item_name AS item_name
        FROM inventory_events ie
        LEFT JOIN receiving_lines rl ON rl.id = ie.receiving_line_id${rlOrg}
       WHERE COALESCE(rl.sku, ie.sku, '') <> ''${ieOrg}
    )
    SELECT sku,
           MAX(item_name) AS item_name,
           COUNT(*)::int AS event_count,
           MAX(occurred_at) AS latest_event_at
      FROM events
      ${filterSql}
     GROUP BY sku
     ORDER BY latest_event_at DESC NULLS LAST
     LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const { rows } = orgId
    ? await tenantQuery(orgId, sql, params)
    : await pool.query(sql, params);
  return rows.map((r: Record<string, unknown>) => ({
    sku: r.sku as string,
    item_name: r.item_name as string | null,
    event_count: Number(r.event_count ?? 0),
    latest_event_at: r.latest_event_at as string | null,
  }));
}

export async function getSkuDetail(
  sku: string,
  filters: AuditLogFilters,
  orgId?: OrgId,
): Promise<SkuDetail | null> {
  const dateStart = filters.range.start;
  const dateEnd = filters.range.end;
  const staffId = filters.staffId;

  // When orgId is present, $1 holds the org and the SKU shifts to $2; the rest
  // of the positional params follow. Each tenant table also gains an explicit
  // `<t>.organization_id = $1` predicate (in the ON clause for LEFT JOINs so the
  // line-less / unmatched-order behavior is preserved). When orgId is omitted
  // the original $1=sku layout and raw-pool path are kept byte-identical.
  // shipping_tracking_numbers has NO organization_id column; it is joined by
  // its integer surrogate PK (stn.id = ...shipment_id), so it is implicitly
  // scoped through its org-bearing parent rows (see notes / needsColTables).
  const orgPrefix: unknown[] = orgId ? [orgId] : [];
  const skuIdx = orgId ? 2 : 1; // positional index of the sku param
  const orgPred = orgId ? '$1' : '';
  const salOrg = orgId ? ` AND sal.organization_id = ${orgPred}` : '';
  const plOrg = orgId ? ` AND pl.organization_id = ${orgPred}` : '';
  const oOrg = orgId ? ` AND o.organization_id = ${orgPred}` : '';
  const tsnOrg = orgId ? ` AND tsn.organization_id = ${orgPred}` : '';
  const skOrg = orgId ? ` AND sk.organization_id = ${orgPred}` : '';
  const ieOrg = orgId ? ` AND ie.organization_id = ${orgPred}` : '';
  const rlOrg = orgId ? ` AND rl.organization_id = ${orgPred}` : '';

  const buildDateClauses = (col: string, startParamIdx: number): { sql: string; params: unknown[] } => {
    const params: unknown[] = [];
    const parts: string[] = [];
    if (dateStart) {
      params.push(dateStart);
      parts.push(`${col} >= $${startParamIdx + params.length}::timestamptz`);
    }
    if (dateEnd) {
      params.push(dateEnd);
      parts.push(`${col} <= $${startParamIdx + params.length}::timestamptz`);
    }
    return { sql: parts.join(' AND '), params };
  };

  const runQuery = orgId
    ? <R extends QueryResultRow>(text: string, params: unknown[]) => tenantQuery<R>(orgId, text, params)
    : <R extends QueryResultRow>(text: string, params: unknown[]) => pool.query<R>(text, params);

  // 1) Packer events.
  const packerParams: unknown[] = [...orgPrefix, sku];
  let p1 = buildDateClauses('sal.created_at', packerParams.length);
  packerParams.push(...p1.params);
  let packerWhere = `o.sku = $${skuIdx}${p1.sql ? ` AND ${p1.sql}` : ''}`;
  if (staffId != null) {
    packerParams.push(staffId);
    packerWhere += ` AND sal.staff_id = $${packerParams.length}`;
  }
  const packerRes = await runQuery(
    `SELECT sal.id,
            sal.created_at,
            sal.activity_type,
            sal.staff_id,
            s.name AS actor_name,
            sal.station,
            sal.notes,
            sal.metadata,
            stn.tracking_number_raw AS tracking,
            o.product_title AS item_name
       FROM station_activity_logs sal
       JOIN packer_logs pl ON pl.id = sal.packer_log_id${plOrg}
       LEFT JOIN orders o ON o.shipment_id = pl.shipment_id${oOrg}
       LEFT JOIN staff s ON s.id = sal.staff_id
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
       WHERE ${packerWhere}${salOrg}
       ORDER BY sal.created_at DESC
       LIMIT 500`,
    packerParams,
  );

  // 2) Tech events (via source_sku_id).
  const techParams: unknown[] = [...orgPrefix, sku];
  let p2 = buildDateClauses('sal.created_at', techParams.length);
  techParams.push(...p2.params);
  let techWhere = `sk.static_sku = $${skuIdx}${p2.sql ? ` AND ${p2.sql}` : ''}`;
  if (staffId != null) {
    techParams.push(staffId);
    techWhere += ` AND sal.staff_id = $${techParams.length}`;
  }
  const techRes = await runQuery(
    `SELECT sal.id,
            sal.created_at,
            sal.activity_type,
            sal.staff_id,
            s.name AS actor_name,
            sal.station,
            sal.notes,
            sal.metadata,
            stn.tracking_number_raw AS tracking,
            tsn.serial_number
       FROM station_activity_logs sal
       JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id${tsnOrg}
       JOIN sku sk ON sk.id = tsn.source_sku_id${skOrg}
       LEFT JOIN staff s ON s.id = sal.staff_id
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = COALESCE(sal.shipment_id, tsn.shipment_id)
       WHERE ${techWhere}${salOrg}
       ORDER BY sal.created_at DESC
       LIMIT 500`,
    techParams,
  );

  // 3) Lifecycle spine. LEFT JOIN + COALESCE(rl.sku, ie.sku) so line-less
  //    serial/SKU events (e.g. ADMIN label prints → LABELED, which carry
  //    ie.sku but no receiving_line_id) surface under their SKU here — the
  //    SKU view is the home for label-print activity that has no line/PO/tracking.
  const recParams: unknown[] = [...orgPrefix, sku];
  let p3 = buildDateClauses('ie.occurred_at', recParams.length);
  recParams.push(...p3.params);
  let recWhere = `COALESCE(rl.sku, ie.sku) = $${skuIdx}${p3.sql ? ` AND ${p3.sql}` : ''}`;
  if (staffId != null) {
    recParams.push(staffId);
    recWhere += ` AND ie.actor_staff_id = $${recParams.length}`;
  }
  const recRes = await runQuery(
    `SELECT ie.id,
            ie.occurred_at,
            ie.event_type,
            ie.actor_staff_id,
            s.name AS actor_name,
            rl.item_name,
            rl.receiving_id,
            rl.zoho_purchaseorder_id
       FROM inventory_events ie
       LEFT JOIN receiving_lines rl ON rl.id = ie.receiving_line_id${rlOrg}
       LEFT JOIN staff s ON s.id = ie.actor_staff_id
       WHERE ${recWhere}${ieOrg}
       ORDER BY ie.occurred_at DESC
       LIMIT 500`,
    recParams,
  );

  const events: SkuEvent[] = [];
  let itemName: string | null = null;

  for (const r of packerRes.rows) {
    if (!itemName && r.item_name) itemName = r.item_name as string;
    events.push({
      id: `sal-pack:${r.id}`,
      occurred_at: r.created_at as string,
      source: 'station_activity_log',
      station: 'packing',
      kind: r.activity_type as string,
      actor_staff_id: r.staff_id as number | null,
      actor_name: r.actor_name as string | null,
      tracking: r.tracking as string | null,
      serial_number: null,
      notes: r.notes as string | null,
      detail: { metadata: r.metadata },
    });
  }
  for (const r of techRes.rows) {
    events.push({
      id: `sal-tech:${r.id}`,
      occurred_at: r.created_at as string,
      source: 'station_activity_log',
      station: 'tech',
      kind: r.activity_type as string,
      actor_staff_id: r.staff_id as number | null,
      actor_name: r.actor_name as string | null,
      tracking: r.tracking as string | null,
      serial_number: r.serial_number as string | null,
      notes: r.notes as string | null,
      detail: { metadata: r.metadata },
    });
  }
  for (const r of recRes.rows) {
    if (!itemName && r.item_name) itemName = r.item_name as string;
    events.push({
      id: `ie:${r.id}`,
      occurred_at: r.occurred_at as string,
      source: 'inventory_event',
      station: 'receiving',
      kind: r.event_type as string,
      actor_staff_id: r.actor_staff_id as number | null,
      actor_name: r.actor_name as string | null,
      tracking: null,
      serial_number: null,
      notes: null,
      detail: {
        receiving_id: r.receiving_id,
        zoho_purchaseorder_id: r.zoho_purchaseorder_id,
      },
    });
  }

  events.sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );

  const counts = { receiving: 0, packing: 0, tech: 0, other: 0 } as Record<
    'receiving' | 'packing' | 'tech' | 'other',
    number
  >;
  for (const ev of events) counts[ev.station] += 1;

  return {
    sku,
    item_name: itemName,
    events,
    counts,
  };
}
