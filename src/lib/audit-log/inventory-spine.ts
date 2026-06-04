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

  const order = opts.order === 'desc' ? 'DESC' : 'ASC';
  let limitSql = '';
  if (opts.limit != null) {
    params.push(opts.limit);
    limitSql = `LIMIT $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT ie.id,
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
       LEFT JOIN staff s ON s.id = ie.actor_staff_id
       LEFT JOIN serial_units su ON su.id = ie.serial_unit_id
      WHERE ${where.join(' AND ')}
      ORDER BY ie.occurred_at ${order}, ie.id ${order}
      ${limitSql}`,
    params,
  );

  return rows as InventoryEventRecord[];
}
