/**
 * Read-only aggregator for the Packing audit-log section.
 *
 * Sources:
 *   • packer_logs                — one row per pack event (FK → shipping_tracking_numbers, staff)
 *   • station_activity_logs      — granular events tagged with packer_log_id
 *   • audit_logs                 — entity_type='PACKER_LOG' diffs, or station_activity_log_id matches
 *   • orders                     — SKU summary per tracking (multi-SKU orders aggregated)
 *   • shipping_tracking_numbers  — canonical tracking text
 *   • staff                      — actor names
 */

import 'server-only';
import pool from '@/lib/db';
import type { AuditLogFilters } from './filters';

export interface PackingTrackingSummary {
  tracking: string;
  packer_log_id: number;
  pack_date_time: string | null;
  packed_by_id: number | null;
  packed_by_name: string | null;
  sku_summary: string | null;
  event_count: number;
}

export interface PackingEvent {
  id: string;
  occurred_at: string;
  source: 'packer_log' | 'station_activity_log' | 'audit_log' | 'photo';
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  notes: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

export interface PackingTrackingDetail {
  tracking: string;
  packer_logs: Array<{
    id: number;
    pack_date_time: string | null;
    packed_by_id: number | null;
    packed_by_name: string | null;
    tracking_type: string | null;
    photo_urls: string[];
  }>;
  events: PackingEvent[];
  sku_summary: string | null;
}

interface ListOpts {
  filters: AuditLogFilters;
  search: string | null;
}

export async function listPackingTrackings(opts: ListOpts): Promise<PackingTrackingSummary[]> {
  const { filters, search } = opts;
  const params: unknown[] = [];
  const where: string[] = ['pl.shipment_id IS NOT NULL'];

  if (filters.range.start) {
    params.push(filters.range.start);
    where.push(`pl.created_at >= $${params.length}::timestamptz`);
  }
  if (filters.range.end) {
    params.push(filters.range.end);
    where.push(`pl.created_at <= $${params.length}::timestamptz`);
  }
  if (filters.staffId != null) {
    params.push(filters.staffId);
    where.push(`pl.packed_by = $${params.length}`);
  }
  if (filters.sku) {
    params.push(filters.sku);
    where.push(`EXISTS (
      SELECT 1 FROM orders o
       WHERE o.shipment_id = pl.shipment_id AND o.sku = $${params.length}
    )`);
  }
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(
      stn.tracking_number_raw ILIKE ${p}
      OR COALESCE(s.name, '') ILIKE ${p}
      OR EXISTS (
        SELECT 1 FROM orders o2
         WHERE o2.shipment_id = pl.shipment_id
           AND (o2.sku ILIKE ${p} OR o2.product_title ILIKE ${p})
      )
    )`);
  }

  params.push(filters.limit);
  const limitParam = `$${params.length}`;
  params.push(filters.offset);
  const offsetParam = `$${params.length}`;

  const sql = `
    SELECT
      stn.tracking_number_raw AS tracking,
      pl.id AS packer_log_id,
      pl.created_at AS pack_date_time,
      pl.packed_by AS packed_by_id,
      s.name AS packed_by_name,
      (
        SELECT string_agg(DISTINCT o.sku, ', ' ORDER BY o.sku)
          FROM orders o
         WHERE o.shipment_id = pl.shipment_id AND COALESCE(o.sku, '') <> ''
      ) AS sku_summary,
      (
        SELECT COUNT(*)::int
          FROM station_activity_logs sal
         WHERE sal.packer_log_id = pl.id
      ) AS event_count
    FROM packer_logs pl
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
    LEFT JOIN staff s ON s.id = pl.packed_by
    WHERE ${where.join(' AND ')}
    ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;
  const { rows } = await pool.query(sql, params);

  return rows.map((r: Record<string, unknown>) => ({
    tracking: (r.tracking as string | null) ?? `pl#${r.packer_log_id}`,
    packer_log_id: r.packer_log_id as number,
    pack_date_time: r.pack_date_time as string | null,
    packed_by_id: r.packed_by_id as number | null,
    packed_by_name: r.packed_by_name as string | null,
    sku_summary: r.sku_summary as string | null,
    event_count: Number(r.event_count ?? 0),
  }));
}

export async function getPackingTrackingDetail(
  tracking: string,
  filters: AuditLogFilters,
): Promise<PackingTrackingDetail | null> {
  // Resolve shipment_id from the tracking text (case/punctuation tolerant).
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

  const packerLogsRes = await pool.query(
    `SELECT pl.id,
            pl.created_at AS pack_date_time,
            pl.packed_by AS packed_by_id,
            s.name AS packed_by_name,
            pl.tracking_type,
            pl.packer_photos_url
       FROM packer_logs pl
       LEFT JOIN staff s ON s.id = pl.packed_by
       WHERE pl.shipment_id = $1
       ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC`,
    [shipmentId],
  );

  const packerLogIds = packerLogsRes.rows.map((r: Record<string, unknown>) => r.id as number);

  // SAL events linked to any of these packer_logs.
  const salParams: unknown[] = [packerLogIds.length > 0 ? packerLogIds : [-1]];
  const salWhere: string[] = [`sal.packer_log_id = ANY($1::int[])`];
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
            sal.metadata
       FROM station_activity_logs sal
       LEFT JOIN staff s ON s.id = sal.staff_id
       WHERE ${salWhere.join(' AND ')}
       ORDER BY sal.created_at ASC`,
    salParams,
  );

  // Audit logs that point at these packer_logs (either via entity_type/entity_id or station_activity_log_id).
  const auditParams: unknown[] = [
    packerLogIds.length > 0 ? packerLogIds : [-1],
    salRes.rows.length > 0 ? salRes.rows.map((r: Record<string, unknown>) => r.id) : [-1],
  ];
  const auditWhere = [
    `(
       (al.entity_type = 'PACKER_LOG' AND al.entity_id = ANY($1::text[]))
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
    [
      packerLogIds.length > 0 ? packerLogIds.map((id: number) => String(id)) : ['-1'],
      ...auditParams.slice(1),
    ],
  );

  const events: PackingEvent[] = [];

  for (const pl of packerLogsRes.rows) {
    if (pl.pack_date_time) {
      events.push({
        id: `pl:${pl.id}`,
        occurred_at: pl.pack_date_time as string,
        source: 'packer_log',
        kind: 'PACK_COMPLETED',
        actor_staff_id: pl.packed_by_id as number | null,
        actor_name: pl.packed_by_name as string | null,
        station: null,
        notes: null,
        before: null,
        after: null,
        detail: { tracking_type: pl.tracking_type, packer_log_id: pl.id },
      });
    }
    const photoUrls = Array.isArray(pl.packer_photos_url)
      ? (pl.packer_photos_url as unknown[]).filter((u): u is string => typeof u === 'string')
      : [];
    for (let i = 0; i < photoUrls.length; i++) {
      events.push({
        id: `photo:${pl.id}:${i}`,
        occurred_at: pl.pack_date_time as string,
        source: 'photo',
        kind: 'PHOTO_ADDED',
        actor_staff_id: pl.packed_by_id as number | null,
        actor_name: pl.packed_by_name as string | null,
        station: null,
        notes: null,
        before: null,
        after: null,
        detail: { url: photoUrls[i] },
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

  // Apply date range filtering on the merged event stream.
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

  // SKU summary across all orders for this tracking.
  const skuRes = await pool.query(
    `SELECT string_agg(DISTINCT sku, ', ' ORDER BY sku) AS sku_summary
       FROM orders
       WHERE shipment_id = $1 AND COALESCE(sku, '') <> ''`,
    [shipmentId],
  );

  return {
    tracking: canonicalTracking,
    packer_logs: packerLogsRes.rows.map((pl: Record<string, unknown>) => ({
      id: pl.id as number,
      pack_date_time: pl.pack_date_time as string | null,
      packed_by_id: pl.packed_by_id as number | null,
      packed_by_name: pl.packed_by_name as string | null,
      tracking_type: pl.tracking_type as string | null,
      photo_urls: Array.isArray(pl.packer_photos_url)
        ? (pl.packer_photos_url as unknown[]).filter((u): u is string => typeof u === 'string')
        : [],
    })),
    events: filteredEvents,
    sku_summary: (skuRes.rows[0]?.sku_summary as string | null) ?? null,
  };
}
