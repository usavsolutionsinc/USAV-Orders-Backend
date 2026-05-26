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

export interface TechSessionSummary {
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
  source: 'tech_serial_number' | 'station_activity_log' | 'audit_log';
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
  const where: string[] = ['tsn.shipment_id IS NOT NULL'];

  if (filters.range.start) {
    params.push(filters.range.start);
    where.push(`tsn.created_at >= $${params.length}::timestamptz`);
  }
  if (filters.range.end) {
    params.push(filters.range.end);
    where.push(`tsn.created_at <= $${params.length}::timestamptz`);
  }
  if (filters.staffId != null) {
    params.push(filters.staffId);
    where.push(`tsn.tested_by = $${params.length}`);
  }
  if (filters.sku) {
    params.push(filters.sku);
    where.push(`(
      EXISTS (SELECT 1 FROM sku sk WHERE sk.id = tsn.source_sku_id AND sk.static_sku = $${params.length})
      OR EXISTS (
        SELECT 1 FROM orders o
         WHERE o.shipment_id = tsn.shipment_id AND o.sku = $${params.length}
      )
    )`);
  }
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(
      stn.tracking_number_raw ILIKE ${p}
      OR tsn.serial_number ILIKE ${p}
      OR COALESCE(s.name, '') ILIKE ${p}
    )`);
  }

  params.push(filters.limit);
  const limitParam = `$${params.length}`;
  params.push(filters.offset);
  const offsetParam = `$${params.length}`;

  const sql = `
    WITH grouped AS (
      SELECT
        stn.tracking_number_raw AS tracking,
        tsn.shipment_id AS shipment_id,
        MAX(tsn.created_at) AS latest_event_at,
        COUNT(*)::int AS serial_count,
        MAX(tsn.tested_by) AS tester_id
      FROM tech_serial_numbers tsn
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
      LEFT JOIN staff s ON s.id = tsn.tested_by
      WHERE ${where.join(' AND ')}
      GROUP BY stn.tracking_number_raw, tsn.shipment_id
    )
    SELECT
      g.tracking,
      g.tester_id,
      ts.name AS tester_name,
      g.serial_count,
      g.latest_event_at,
      (
        SELECT string_agg(DISTINCT COALESCE(sk.static_sku, o.sku), ', ')
          FROM tech_serial_numbers tsn2
          LEFT JOIN sku sk ON sk.id = tsn2.source_sku_id
          LEFT JOIN orders o ON o.shipment_id = tsn2.shipment_id
         WHERE tsn2.shipment_id = g.shipment_id
           AND COALESCE(sk.static_sku, o.sku) IS NOT NULL
      ) AS sku_summary
    FROM grouped g
    LEFT JOIN staff ts ON ts.id = g.tester_id
    ORDER BY g.latest_event_at DESC NULLS LAST
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;
  const { rows } = await pool.query(sql, params);

  return rows.map((r: Record<string, unknown>) => ({
    tracking: (r.tracking as string | null) ?? 'unknown',
    tester_id: r.tester_id as number | null,
    tester_name: r.tester_name as string | null,
    serial_count: Number(r.serial_count ?? 0),
    latest_event_at: r.latest_event_at as string | null,
    sku_summary: r.sku_summary as string | null,
  }));
}

export async function getTechSessionDetail(
  tracking: string,
  filters: AuditLogFilters,
): Promise<TechSessionDetail | null> {
  const trackingRes = await pool.query(
    `SELECT id, tracking_number_raw
       FROM shipping_tracking_numbers
       WHERE tracking_number_raw = $1
          OR tracking_number_normalized = $1
          OR tracking_number_normalized = UPPER(REGEXP_REPLACE($1, '[^A-Za-z0-9]', '', 'g'))
       LIMIT 1`,
    [tracking],
  );
  if (trackingRes.rows.length === 0) return null;
  const shipmentId = trackingRes.rows[0].id as number;
  const canonicalTracking = trackingRes.rows[0].tracking_number_raw as string;

  const serialsRes = await pool.query(
    `SELECT tsn.id,
            tsn.serial_number,
            tsn.serial_type,
            tsn.created_at AS test_date_time,
            tsn.tested_by AS tester_id,
            s.name AS tester_name,
            sk.static_sku AS sku
       FROM tech_serial_numbers tsn
       LEFT JOIN staff s ON s.id = tsn.tested_by
       LEFT JOIN sku sk ON sk.id = tsn.source_sku_id
       WHERE tsn.shipment_id = $1
       ORDER BY tsn.created_at DESC NULLS LAST, tsn.id DESC`,
    [shipmentId],
  );

  const serialIds = serialsRes.rows.map((r: Record<string, unknown>) => r.id as number);

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

  const events: TechEvent[] = [];

  for (const r of serialsRes.rows) {
    if (r.test_date_time) {
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

  const skuRes = await pool.query(
    `SELECT string_agg(DISTINCT COALESCE(sk.static_sku, o.sku), ', ') AS sku_summary
       FROM tech_serial_numbers tsn
       LEFT JOIN sku sk ON sk.id = tsn.source_sku_id
       LEFT JOIN orders o ON o.shipment_id = tsn.shipment_id
       WHERE tsn.shipment_id = $1
         AND COALESCE(sk.static_sku, o.sku) IS NOT NULL`,
    [shipmentId],
  );

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
    sku_summary: (skuRes.rows[0]?.sku_summary as string | null) ?? null,
  };
}
