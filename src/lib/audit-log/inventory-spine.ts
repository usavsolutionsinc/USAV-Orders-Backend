/**
 * Shared reader for the `inventory_events` lifecycle spine — the single
 * cross-station event stream that every station writes to (RECEIVED, TEST_*,
 * PUTAWAY, MOVED, PACKED, SHIPPED, …). One batched query, keyed on any of:
 *   • receiving_line_id  (the canonical "Line under PO" anchor)
 *   • serial_unit_id     (per-unit lifecycle, e.g. testing verdicts)
 *   • receiving_id        (carton-level events)
 *
 * Consumers map the normalized rows into their own event shapes:
 *   • receiving-aggregator → AuditEvent
 *   • tech-aggregator      → TechEvent
 *
 * Extracted in the audit-trail anchoring effort (docs/audit-trail-anchor-plan.md,
 * Phase 0) so the inventory_events read isn't duplicated per section.
 */

import 'server-only';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface InventoryEventRecord {
  id: number;
  occurred_at: string;
  event_type: string;
  actor_staff_id: number | null;
  /** Resolved from staff (LEFT JOIN); null when unknown/system. */
  actor_name: string | null;
  station: string | null;
  receiving_id: number | null;
  receiving_line_id: number | null;
  serial_unit_id: number | null;
  /** Resolved from serial_units (LEFT JOIN); null when not serial-scoped. */
  serial_number: string | null;
  sku: string | null;
  bin_id: number | null;
  prev_bin_id: number | null;
  prev_status: string | null;
  next_status: string | null;
  notes: string | null;
  payload: Record<string, unknown>;
}

export interface ReadInventorySpineOpts {
  /** receiving_lines.id values. */
  lineIds?: number[];
  /** serial_units.id values. */
  serialUnitIds?: number[];
  /** receiving.id (carton) values. */
  cartonIds?: number[];
  /** Restrict to a single actor. */
  staffId?: number | null;
  /** Restrict to specific event_type values (e.g. the outbound lifecycle). */
  eventTypes?: string[];
  /** Timeline direction. Default 'asc' (oldest-first). */
  order?: 'asc' | 'desc';
  /** Row cap. Omit for unbounded. */
  limit?: number;
}

/**
 * Read inventory_events matching ANY of the supplied id sets. Returns [] when
 * no id set is provided (avoids an unbounded table scan).
 */
export async function readInventorySpine(
  opts: ReadInventorySpineOpts,
  orgId?: OrgId,
): Promise<InventoryEventRecord[]> {
  const lineIds = (opts.lineIds ?? []).filter((n) => Number.isFinite(n));
  const serialUnitIds = (opts.serialUnitIds ?? []).filter((n) => Number.isFinite(n));
  const cartonIds = (opts.cartonIds ?? []).filter((n) => Number.isFinite(n));
  if (lineIds.length === 0 && serialUnitIds.length === 0 && cartonIds.length === 0) {
    return [];
  }

  const params: unknown[] = [];
  const ors: string[] = [];
  if (lineIds.length > 0) {
    params.push(lineIds);
    ors.push(`ie.receiving_line_id = ANY($${params.length}::bigint[])`);
  }
  if (serialUnitIds.length > 0) {
    params.push(serialUnitIds);
    ors.push(`ie.serial_unit_id = ANY($${params.length}::int[])`);
  }
  if (cartonIds.length > 0) {
    params.push(cartonIds);
    ors.push(`ie.receiving_id = ANY($${params.length}::bigint[])`);
  }

  const where: string[] = [`(${ors.join(' OR ')})`];
  if (opts.staffId != null) {
    params.push(opts.staffId);
    where.push(`ie.actor_staff_id = $${params.length}`);
  }
  if (opts.eventTypes && opts.eventTypes.length > 0) {
    params.push(opts.eventTypes);
    where.push(`ie.event_type = ANY($${params.length}::text[])`);
  }

  // Tenant scope: when an orgId is threaded through, restrict the spine to the
  // caller's org and keep the LEFT JOINs from reaching across tenants. When
  // omitted, the SQL/params/executor are byte-identical to the legacy path so
  // the many un-migrated callers behave exactly as before.
  let staffJoin = 'LEFT JOIN staff s ON s.id = ie.actor_staff_id';
  let serialJoin = 'LEFT JOIN serial_units su ON su.id = ie.serial_unit_id';
  if (orgId) {
    params.push(orgId);
    where.push(`ie.organization_id = $${params.length}`);
    // Integer surrogate-PK joins are safe bare, but both joined tables are
    // tenant-owned; align org so a cross-tenant LEFT-JOIN row can't surface a
    // foreign actor_name / serial_number.
    staffJoin = 'LEFT JOIN staff s ON s.id = ie.actor_staff_id AND s.organization_id = ie.organization_id';
    serialJoin = 'LEFT JOIN serial_units su ON su.id = ie.serial_unit_id AND su.organization_id = ie.organization_id';
  }

  const order = opts.order === 'desc' ? 'DESC' : 'ASC';
  let limitSql = '';
  if (opts.limit != null) {
    params.push(opts.limit);
    limitSql = `LIMIT $${params.length}`;
  }

  const sql = `SELECT ie.id,
            ie.occurred_at,
            ie.event_type,
            ie.actor_staff_id,
            s.name AS actor_name,
            ie.station,
            ie.receiving_id,
            ie.receiving_line_id,
            ie.serial_unit_id,
            su.serial_number,
            ie.sku,
            ie.bin_id,
            ie.prev_bin_id,
            ie.prev_status,
            ie.next_status,
            ie.notes,
            ie.payload
       FROM inventory_events ie
       ${staffJoin}
       ${serialJoin}
      WHERE ${where.join(' AND ')}
      ORDER BY ie.occurred_at ${order}, ie.id ${order}
      ${limitSql}`;

  const { rows } = orgId
    ? await tenantQuery(orgId, sql, params)
    : await pool.query(sql, params);

  return rows as InventoryEventRecord[];
}
