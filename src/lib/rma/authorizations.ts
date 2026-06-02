/**
 * RMA authorizations — domain module for the Phase A5 entity.
 *
 * Pairs with `rma_authorizations` + `return_dispositions` tables (migration
 * 2026-05-23). Promotes RMA from a `serial_units.current_status` flag to a
 * first-class business object so the warehouse can:
 *   - Issue an RMA number before the carton arrives
 *   - Track customer returns AND vendor returns (RTV) in the same table
 *   - Record a typed disposition per unit after inspection
 *   - Look up the history of any returned serial
 *
 * Workflow:
 *   1. `createAuthorization({...})`            — issues a new RMA-NNNNN number
 *   2. (RMA carton arrives) `markReceived({})` — AUTHORIZED → RECEIVED
 *   3. `recordDisposition({...})`              — one row per unit decision
 *   4. `closeAuthorization({...})`             — when all units dispositioned
 */

import pool from '@/lib/db';
import { recordInventoryEvent } from '@/lib/inventory/events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RmaDirection = 'INBOUND_FROM_CUSTOMER' | 'OUTBOUND_TO_VENDOR';
export type RmaStatus =
  | 'AUTHORIZED'
  | 'RECEIVED'
  | 'DISPOSITIONED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'CANCELED';
export type DispositionCode = 'ACCEPT' | 'HOLD' | 'RTV' | 'REWORK' | 'SCRAP';

export interface RmaAuthorizationRow {
  id: number;
  rmaNumber: string;
  direction: RmaDirection;
  orderId: number | null;
  customerId: number | null;
  authorizedAt: string;
  expiresAt: string | null;
  expectedCarrier: string | null;
  status: RmaStatus;
  createdByStaffId: number | null;
  closedAt: string | null;
  notes: string | null;
}

export interface CreateAuthorizationInput {
  direction: RmaDirection;
  orderId?: number | null;
  customerId?: number | null;
  expiresAt?: Date | string | null;
  expectedCarrier?: string | null;
  createdByStaffId: number;
  notes?: string | null;
}

export type CreateAuthorizationResult =
  | { ok: true; rma: RmaAuthorizationRow }
  | { ok: false; status: 409 | 500; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate the next RMA number for the current year. Format `RMA-YYYY-NNNNN`.
 *
 * Uses a separate read+write rather than a sequence because (a) the format
 * must reset per year and (b) the per-year counter is a small enough table
 * to make a sequence-per-year clunky.
 */
async function nextRmaNumber(): Promise<string> {
  const year = new Date().getFullYear();
  // Count existing RMAs for the year and bump. A small race here just means
  // two parallel calls fail the UNIQUE constraint and one retries — handled
  // by the caller via `rma_number UNIQUE` collision retry below.
  const { rows } = await pool.query<{ next_seq: number }>(
    `SELECT COALESCE(MAX(
              (regexp_replace(rma_number, '^RMA-\\d{4}-', ''))::int
            ), 0) + 1 AS next_seq
       FROM rma_authorizations
      WHERE rma_number LIKE $1`,
    [`RMA-${year}-%`],
  );
  const seq = rows[0]?.next_seq ?? 1;
  return `RMA-${year}-${String(seq).padStart(5, '0')}`;
}

function mapRow(row: {
  id: number;
  rma_number: string;
  direction: RmaDirection;
  order_id: number | null;
  customer_id: number | null;
  authorized_at: string;
  expires_at: string | null;
  expected_carrier: string | null;
  status: RmaStatus;
  created_by_staff_id: number | null;
  closed_at: string | null;
  notes: string | null;
}): RmaAuthorizationRow {
  return {
    id: row.id,
    rmaNumber: row.rma_number,
    direction: row.direction,
    orderId: row.order_id,
    customerId: row.customer_id,
    authorizedAt: row.authorized_at,
    expiresAt: row.expires_at,
    expectedCarrier: row.expected_carrier,
    status: row.status,
    createdByStaffId: row.created_by_staff_id,
    closedAt: row.closed_at,
    notes: row.notes,
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createAuthorization(
  input: CreateAuthorizationInput,
): Promise<CreateAuthorizationResult> {
  // Up to 3 retries to handle the rare per-year sequence race.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rmaNumber = await nextRmaNumber();
    try {
      const expiresAt =
        input.expiresAt instanceof Date
          ? input.expiresAt.toISOString()
          : (input.expiresAt ?? null);
      const { rows } = await pool.query<RmaAuthorizationRow & Record<string, unknown>>(
        `INSERT INTO rma_authorizations (
           rma_number, direction, order_id, customer_id,
           expires_at, expected_carrier, created_by_staff_id, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, rma_number, direction, order_id, customer_id,
                   authorized_at::text, expires_at::text, expected_carrier, status,
                   created_by_staff_id, closed_at::text, notes`,
        [
          rmaNumber,
          input.direction,
          input.orderId ?? null,
          input.customerId ?? null,
          expiresAt,
          input.expectedCarrier ?? null,
          input.createdByStaffId,
          input.notes ?? null,
        ],
      );
      return { ok: true, rma: mapRow(rows[0] as never) };
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // Duplicate UNIQUE on rma_number — retry with a fresh number.
      if (/duplicate key value/i.test(message) && attempt < 2) continue;
      return { ok: false, status: 500, error: message || 'unknown DB error' };
    }
  }
  return { ok: false, status: 500, error: 'failed to generate unique rma_number after 3 attempts' };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export type MarkReceivedResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export async function markReceived(input: { rmaId: number }): Promise<MarkReceivedResult> {
  const { rowCount } = await pool.query(
    `UPDATE rma_authorizations
        SET status = 'RECEIVED'
      WHERE id = $1
        AND status = 'AUTHORIZED'`,
    [input.rmaId],
  );
  if (rowCount === 0) {
    const check = await pool.query<{ status: RmaStatus }>(
      `SELECT status FROM rma_authorizations WHERE id = $1`,
      [input.rmaId],
    );
    if (check.rowCount === 0) return { ok: false, status: 404, error: 'rma not found' };
    return { ok: false, status: 409, error: `rma is ${check.rows[0].status}, expected AUTHORIZED` };
  }
  return { ok: true };
}

export interface RecordDispositionInput {
  rmaId: number | null;
  serialUnitId: number | null;
  dispositionCode: DispositionCode;
  decidedByStaffId: number;
  notes?: string | null;
}

export type RecordDispositionResult =
  | { ok: true; dispositionId: number; eventId: number | null }
  | { ok: false; status: 400 | 404 | 500; error: string };

export async function recordDisposition(
  input: RecordDispositionInput,
): Promise<RecordDispositionResult> {
  if (input.rmaId == null && input.serialUnitId == null) {
    return { ok: false, status: 400, error: 'rmaId or serialUnitId required' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Optional verification — if rma id given, confirm it exists.
    if (input.rmaId != null) {
      const check = await client.query(
        `SELECT 1 FROM rma_authorizations WHERE id = $1`,
        [input.rmaId],
      );
      if (check.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'rma not found' };
      }
    }

    let eventId: number | null = null;
    if (input.serialUnitId != null) {
      const unitQ = await client.query<{ sku: string | null; current_status: string }>(
        `SELECT sku, current_status::text AS current_status
           FROM serial_units WHERE id = $1 FOR UPDATE`,
        [input.serialUnitId],
      );
      const unit = unitQ.rows[0];
      if (unit) {
        const event = await recordInventoryEvent(
          {
            event_type: 'NOTE',
            actor_staff_id: input.decidedByStaffId,
            station: 'SYSTEM',
            serial_unit_id: input.serialUnitId,
            sku: unit.sku,
            prev_status: unit.current_status,
            next_status: unit.current_status,
            notes: `disposition: ${input.dispositionCode}${input.notes ? ` — ${input.notes}` : ''}`,
            payload: {
              source: 'rma.disposition',
              rmaId: input.rmaId,
              dispositionCode: input.dispositionCode,
            },
          },
          client,
        );
        eventId = event.id;
      }
    }

    const dispQ = await client.query<{ id: number }>(
      `INSERT INTO return_dispositions (
         rma_id, serial_unit_id, disposition_code, decided_by_staff_id, notes, inventory_event_id
       ) VALUES ($1, $2, $3::disposition_enum, $4, $5, $6)
       RETURNING id`,
      [
        input.rmaId,
        input.serialUnitId,
        input.dispositionCode,
        input.decidedByStaffId,
        input.notes ?? null,
        eventId,
      ],
    );

    // If at least one disposition exists for an RMA still in RECEIVED, bump
    // it to DISPOSITIONED so the supervisor list reflects progress.
    if (input.rmaId != null) {
      await client.query(
        `UPDATE rma_authorizations
            SET status = 'DISPOSITIONED'
          WHERE id = $1 AND status = 'RECEIVED'`,
        [input.rmaId],
      );
    }

    await client.query('COMMIT');
    return { ok: true, dispositionId: dispQ.rows[0].id, eventId };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    const message = err instanceof Error ? err.message : 'disposition failed';
    return { ok: false, status: 500, error: message };
  } finally {
    client.release();
  }
}

export type CloseAuthorizationResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

export async function closeAuthorization(input: { rmaId: number }): Promise<CloseAuthorizationResult> {
  const { rowCount } = await pool.query(
    `UPDATE rma_authorizations
        SET status = 'CLOSED',
            closed_at = NOW()
      WHERE id = $1
        AND status IN ('RECEIVED','DISPOSITIONED')`,
    [input.rmaId],
  );
  if (rowCount === 0) {
    const check = await pool.query<{ status: RmaStatus }>(
      `SELECT status FROM rma_authorizations WHERE id = $1`,
      [input.rmaId],
    );
    if (check.rowCount === 0) return { ok: false, status: 404, error: 'rma not found' };
    return { ok: false, status: 409, error: `rma is ${check.rows[0].status}, cannot close` };
  }
  return { ok: true };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function findByNumber(rmaNumber: string): Promise<RmaAuthorizationRow | null> {
  const { rows } = await pool.query(
    `SELECT id, rma_number, direction, order_id, customer_id,
            authorized_at::text, expires_at::text, expected_carrier, status,
            created_by_staff_id, closed_at::text, notes
       FROM rma_authorizations
      WHERE rma_number = $1
      LIMIT 1`,
    [rmaNumber],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0] as never);
}

export async function listOpen(): Promise<RmaAuthorizationRow[]> {
  const { rows } = await pool.query(
    `SELECT id, rma_number, direction, order_id, customer_id,
            authorized_at::text, expires_at::text, expected_carrier, status,
            created_by_staff_id, closed_at::text, notes
       FROM rma_authorizations
      WHERE status IN ('AUTHORIZED','RECEIVED','DISPOSITIONED')
      ORDER BY authorized_at DESC`,
  );
  return rows.map((r) => mapRow(r as never));
}

export async function findById(rmaId: number): Promise<RmaAuthorizationRow | null> {
  const { rows } = await pool.query(
    `SELECT id, rma_number, direction, order_id, customer_id,
            authorized_at::text, expires_at::text, expected_carrier, status,
            created_by_staff_id, closed_at::text, notes
       FROM rma_authorizations
      WHERE id = $1
      LIMIT 1`,
    [rmaId],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0] as never);
}

// ─── Record-level update / cancel ─────────────────────────────────────────────
//
// These edit the RMA *record* (mutable metadata + a soft-cancel). Lifecycle
// status transitions (AUTHORIZED→RECEIVED→DISPOSITIONED→CLOSED) stay in their
// dedicated verb routes — PATCH here intentionally cannot move `status`.

export interface UpdateAuthorizationInput {
  rmaId: number;
  expectedCarrier?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
}

export type UpdateAuthorizationResult =
  | { ok: true; rma: RmaAuthorizationRow }
  | { ok: false; status: 404; error: string };

/**
 * Patch mutable metadata (carrier / expiry / notes). COALESCE semantics:
 * `null`/omitted fields leave the column untouched.
 */
export async function updateAuthorization(
  input: UpdateAuthorizationInput,
): Promise<UpdateAuthorizationResult> {
  const { rows } = await pool.query(
    `UPDATE rma_authorizations SET
        expected_carrier = COALESCE($2, expected_carrier),
        expires_at       = COALESCE($3::timestamptz, expires_at),
        notes            = COALESCE($4, notes)
      WHERE id = $1
      RETURNING id, rma_number, direction, order_id, customer_id,
                authorized_at::text, expires_at::text, expected_carrier, status,
                created_by_staff_id, closed_at::text, notes`,
    [input.rmaId, input.expectedCarrier ?? null, input.expiresAt ?? null, input.notes ?? null],
  );
  if (rows.length === 0) return { ok: false, status: 404, error: 'rma not found' };
  return { ok: true, rma: mapRow(rows[0] as never) };
}

export type CancelAuthorizationResult =
  | { ok: true; rma: RmaAuthorizationRow }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Soft-cancel — AUTHORIZED → CANCELED. Only an RMA that hasn't yet received
 * goods can be canceled; once it's RECEIVED/DISPOSITIONED it must be closed
 * through the normal flow. We never hard-delete (units + dispositions FK here).
 */
export async function cancelAuthorization(input: { rmaId: number }): Promise<CancelAuthorizationResult> {
  const { rows } = await pool.query(
    `UPDATE rma_authorizations
        SET status = 'CANCELED', closed_at = NOW()
      WHERE id = $1 AND status = 'AUTHORIZED'
      RETURNING id, rma_number, direction, order_id, customer_id,
                authorized_at::text, expires_at::text, expected_carrier, status,
                created_by_staff_id, closed_at::text, notes`,
    [input.rmaId],
  );
  if (rows.length === 0) {
    const check = await pool.query<{ status: RmaStatus }>(
      `SELECT status FROM rma_authorizations WHERE id = $1`,
      [input.rmaId],
    );
    if (check.rowCount === 0) return { ok: false, status: 404, error: 'rma not found' };
    return {
      ok: false,
      status: 409,
      error: `rma is ${check.rows[0].status}, only AUTHORIZED RMAs can be canceled`,
    };
  }
  return { ok: true, rma: mapRow(rows[0] as never) };
}
