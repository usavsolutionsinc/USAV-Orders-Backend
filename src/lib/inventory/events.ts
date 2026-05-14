import pool from '@/lib/db';
import type { PoolClient } from 'pg';

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
 */
export async function recordInventoryEvent(
  input: RecordInventoryEventInput,
  db: Pick<PoolClient, 'query'> = pool,
): Promise<InventoryEventRow> {
  const params = [
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

  // ON CONFLICT requires a unique constraint; client_event_id has one (UNIQUE),
  // so the upsert is safe. When no client_event_id is supplied the ON CONFLICT
  // clause is unreachable and we get a fresh insert.
  const result = await db.query<InventoryEventRow>(
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
    params,
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

export async function readTimeline(filter: TimelineFilter): Promise<InventoryEventRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace('$?', `$${params.length}`));
  };

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

  const result = await pool.query<InventoryEventRow>(
    `SELECT * FROM inventory_events
     ${where}
     ORDER BY occurred_at DESC, id DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}
