import pool from '@/lib/db';
import type { PoolClient } from 'pg';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// ── Types ──────────────────────────────────────────────────────────────────

export type InventoryEventType =
  | 'RECEIVED'
  | 'TEST_START'
  | 'TEST_PASS'
  | 'TEST_FAIL'
  | 'PUTAWAY'
  | 'MOVED'
  | 'PICKED'
  | 'PACKED'
  | 'SHIPPED'
  | 'ADJUSTED'
  | 'RETURNED'
  | 'SCRAPPED'
  | 'LISTED'
  | 'LABELED'
  | 'ALLOCATED'
  | 'RELEASED'
  | 'REPAIR_STARTED'
  | 'REPAIR_COMPLETED'
  | 'NOTE';

export type InventoryEventStation =
  | 'RECEIVING'
  | 'TECH'
  | 'PACK'
  | 'SHIP'
  | 'MOBILE'
  | 'SYSTEM';

export interface RecordInventoryEventInput {
  event_type: InventoryEventType;
  actor_staff_id?: number | null;
  station?: InventoryEventStation | null;

  receiving_id?: number | null;
  receiving_line_id?: number | null;
  serial_unit_id?: number | null;
  sku?: string | null;

  bin_id?: number | null;
  prev_bin_id?: number | null;

  prev_status?: string | null;
  next_status?: string | null;

  stock_ledger_id?: number | null;

  scan_token?: string | null;
  /** UNIQUE — pass to make mobile retries idempotent. */
  client_event_id?: string | null;
  notes?: string | null;
  payload?: Record<string, unknown>;
}

export interface InventoryEventRow {
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
  stock_ledger_id: number | null;
  scan_token: string | null;
  client_event_id: string | null;
  notes: string | null;
  payload: Record<string, unknown>;
}

// ── Writer ─────────────────────────────────────────────────────────────────

/**
 * Insert one row into inventory_events. Returns the inserted row, or the
 * pre-existing row when a client_event_id collision is detected (idempotent
 * retry support).
 *
 * Pass `db` to share a transaction with the caller; otherwise uses the pool
 * directly.
 *
 * Tenancy (backward-compatible): pass `orgId` to scope the write to a tenant.
 * - When `orgId` is OMITTED the behavior is unchanged — the raw `db`/pool
 *   insert runs exactly as before and `organization_id` falls to the column
 *   default (USAV backfill / GUC, depending on the DB). All existing callers
 *   keep compiling and behaving identically.
 * - When `orgId` is PRESENT the row is stamped with `organization_id`. If a
 *   caller `db` (existing transaction client) was supplied, the GUC is set on
 *   that client first (so the table's GUC default + RLS see the right tenant);
 *   otherwise the insert runs via `tenantQuery(orgId, …)` (a single, self-
 *   contained GUC-scoped statement).
 */
export async function recordInventoryEvent(
  input: RecordInventoryEventInput,
  db?: Pick<PoolClient, 'query'>,
  orgId?: OrgId,
): Promise<InventoryEventRow> {
  const baseParams = [
    input.event_type,
    input.actor_staff_id ?? null,
    input.station ?? null,
    input.receiving_id ?? null,
    input.receiving_line_id ?? null,
    input.serial_unit_id ?? null,
    input.sku ?? null,
    input.bin_id ?? null,
    input.prev_bin_id ?? null,
    input.prev_status ?? null,
    input.next_status ?? null,
    input.stock_ledger_id ?? null,
    input.scan_token ?? null,
    input.client_event_id ?? null,
    input.notes ?? null,
    JSON.stringify(input.payload ?? {}),
  ];

  // ── Org-scoped path: stamp organization_id explicitly. ────────────────────
  // ON CONFLICT requires a unique constraint; client_event_id has one (UNIQUE),
  // so the upsert is safe. When no client_event_id is supplied the ON CONFLICT
  // clause is unreachable and we get a fresh insert.
  if (orgId) {
    const orgParams = [...baseParams, orgId];
    const orgSql = `INSERT INTO inventory_events (
       event_type, actor_staff_id, station,
       receiving_id, receiving_line_id, serial_unit_id, sku,
       bin_id, prev_bin_id,
       prev_status, next_status,
       stock_ledger_id,
       scan_token, client_event_id, notes, payload,
       organization_id
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9,
       $10, $11,
       $12,
       $13, $14, $15, $16::jsonb,
       $17
     )
     ON CONFLICT (client_event_id) DO UPDATE
       SET event_type = inventory_events.event_type   -- no-op, return existing row
     RETURNING *`;

    if (db) {
      // Caller owns the transaction — set the GUC on their client so the
      // RLS backstop + GUC column default agree with the explicit stamp.
      await db.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
      const result = await db.query<InventoryEventRow>(orgSql, orgParams);
      return result.rows[0];
    }
    const result = await tenantQuery<InventoryEventRow>(orgId, orgSql, orgParams);
    return result.rows[0];
  }

  // ── Legacy path (no orgId): byte-identical to the original behavior. ───────
  const executor: Pick<PoolClient, 'query'> = db ?? pool;
  const result = await executor.query<InventoryEventRow>(
    `INSERT INTO inventory_events (
       event_type, actor_staff_id, station,
       receiving_id, receiving_line_id, serial_unit_id, sku,
       bin_id, prev_bin_id,
       prev_status, next_status,
       stock_ledger_id,
       scan_token, client_event_id, notes, payload
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9,
       $10, $11,
       $12,
       $13, $14, $15, $16::jsonb
     )
     ON CONFLICT (client_event_id) DO UPDATE
       SET event_type = inventory_events.event_type   -- no-op, return existing row
     RETURNING *`,
    baseParams,
  );

  return result.rows[0];
}

// ── Reads ──────────────────────────────────────────────────────────────────

export interface TimelineFilter {
  receiving_id?: number | null;
  receiving_line_id?: number | null;
  serial_unit_id?: number | null;
  sku?: string | null;
  bin_id?: number | null;
  actor_staff_id?: number | null;
  since?: string | null;        // ISO timestamp
  limit?: number;
}

export async function readTimeline(
  filter: TimelineFilter,
  orgId?: OrgId,
): Promise<InventoryEventRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace('$?', `$${params.length}`));
  };

  // Tenant scope (only when orgId is supplied — keeps the legacy raw path
  // byte-identical for callers that don't yet thread org).
  if (orgId) push('organization_id = $?', orgId);

  if (filter.receiving_id != null)       push('receiving_id = $?',        filter.receiving_id);
  if (filter.receiving_line_id != null)  push('receiving_line_id = $?',   filter.receiving_line_id);
  if (filter.serial_unit_id != null)     push('serial_unit_id = $?',      filter.serial_unit_id);
  if (filter.sku)                        push('sku = $?',                 filter.sku);
  if (filter.bin_id != null)             push('bin_id = $?',              filter.bin_id);
  if (filter.actor_staff_id != null)     push('actor_staff_id = $?',      filter.actor_staff_id);
  if (filter.since)                      push('occurred_at >= $?',        filter.since);

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  params.push(limit);

  const sql = `SELECT * FROM inventory_events
     ${where}
     ORDER BY occurred_at DESC, id DESC
     LIMIT $${params.length}`;

  // When org-scoped, run through the tenant connection so the GUC + RLS
  // backstop are in force; otherwise preserve the original raw pool read.
  const result = orgId
    ? await tenantQuery<InventoryEventRow>(orgId, sql, params)
    : await pool.query<InventoryEventRow>(sql, params);
  return result.rows;
}
