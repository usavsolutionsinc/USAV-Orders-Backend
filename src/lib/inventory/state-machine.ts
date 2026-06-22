/**
 * Serial unit state machine — single source of truth for allowed transitions.
 *
 * Phase A1 of the WMS modernization. Every new state change should go through
 * `transition()` so that:
 *   1. Disallowed transitions are rejected before the UPDATE fires.
 *   2. `serial_units.current_status` and `inventory_events` stay atomic.
 *   3. The allowed-transition graph has one canonical definition (this file).
 *
 * Existing call sites that do raw `UPDATE serial_units SET current_status = ...`
 * keep working — they are not gated yet. Phase A1.1 (follow-up) migrates them
 * one-by-one as their owning workflows are touched.
 */

import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { recordInventoryEvent, type InventoryEventStation, type InventoryEventType } from './events';

// ─── State vocabulary (mirrors serial_status_enum in schema.ts) ──────────────

export const SERIAL_STATES = [
  'UNKNOWN',
  'RECEIVED',
  'TESTED',
  'STOCKED',
  'PICKED',
  'SHIPPED',
  'RETURNED',
  'RMA',
  'SCRAPPED',
  'TRIAGED',
  'IN_REPAIR',
  'REPAIR_DONE',
  'IN_TEST',
  'GRADED',
  'ALLOCATED',
  'PACKED',
  'LABELED',
  'STAGED',
  'ON_HOLD',
  // Phase A2 (active states) — added by migration 2026-05-20_inventory_v2_active_states.sql.
  'PICKING',
  'PACKING',
  'LOADING',
] as const;

export type SerialState = (typeof SERIAL_STATES)[number];

// ─── Transition allow-list ───────────────────────────────────────────────────
// Source of truth for what is reachable from each state. Direction is from → to.
// Any pair not in this map is rejected by guard()/transition().
//
// Keep this terse — additions should be paired with a comment explaining the
// workflow that produced the new edge. ON_HOLD is special-cased below and not
// listed per-state.

const TRANSITIONS: Readonly<Record<SerialState, ReadonlySet<SerialState>>> = {
  UNKNOWN:     new Set<SerialState>(['RECEIVED']),
  RECEIVED:    new Set<SerialState>(['TRIAGED', 'TESTED', 'IN_TEST', 'SCRAPPED', 'STOCKED' /* mark-received direct putaway (auto-stock straight from RECEIVED) */, 'GRADED' /* tech grades a received unit without a formal test-start */, 'IN_REPAIR' /* repair opened straight off the dock */]),
  TRIAGED:     new Set<SerialState>(['IN_REPAIR', 'IN_TEST', 'SCRAPPED', 'GRADED' /* graded straight from triage */]),
  IN_REPAIR:   new Set<SerialState>(['REPAIR_DONE', 'SCRAPPED', 'IN_TEST' /* test reset: clear a wrong FAIL verdict */]),
  REPAIR_DONE: new Set<SerialState>(['IN_TEST', 'GRADED', 'IN_REPAIR' /* re-open repair (more work / failed re-test) */, 'TESTED' /* recordTestVerdict PASS straight off a completed repair */]),
  IN_TEST:     new Set<SerialState>(['GRADED', 'IN_REPAIR', 'SCRAPPED', 'RECEIVED' /* test reset: un-start back to received */, 'TESTED' /* recordTestVerdict PASS — the primary testing happy path (TESTED is the pass state; condition GRADED is a separate axis) */]),
  GRADED:      new Set<SerialState>(['STOCKED', 'SCRAPPED', 'IN_TEST' /* test reset: clear a wrong PASS verdict */, 'IN_REPAIR' /* graded unit found defective → repair */, 'ALLOCATED' /* paired straight to an order from graded */, 'TESTED' /* recordTestVerdict PASS on an already-graded unit (TESTED/GRADED are sibling test-result states) */]),
  TESTED:      new Set<SerialState>(['STOCKED', 'IN_REPAIR', 'SCRAPPED', 'ALLOCATED' /* paired straight to an order from tested */, 'IN_TEST' /* recordTestVerdict TEST_AGAIN: re-test a passed unit */]),
  STOCKED:     new Set<SerialState>(['ALLOCATED', 'RETURNED', 'SCRAPPED', 'RECEIVED', 'TESTED', 'GRADED' /* un-putaway: back to whichever pre-stock state the unit came from (mark-received stocks straight from RECEIVED; testing via TESTED/GRADED) */, 'IN_REPAIR' /* pull stock back for repair */]),
  ALLOCATED:   new Set<SerialState>(['PICKING', 'PICKED', 'STOCKED' /* release */, 'SHIPPED' /* Phase-5 collapsed pick/pack/label/ship in one operator action */]),
  PICKING:     new Set<SerialState>(['PICKED', 'ALLOCATED' /* abandon */]),
  PICKED:      new Set<SerialState>(['PACKING', 'PACKED', 'ALLOCATED' /* re-pick */, 'SHIPPED' /* Phase-5 collapsed pick/pack/label/ship */]),
  PACKING:     new Set<SerialState>(['PACKED', 'PICKED' /* abandon */]),
  PACKED:      new Set<SerialState>(['LABELED', 'LOADING', 'SHIPPED']),
  LABELED:     new Set<SerialState>(['STAGED', 'LOADING', 'SHIPPED']),
  STAGED:      new Set<SerialState>(['LOADING', 'SHIPPED', 'LABELED' /* re-stage */]),
  LOADING:     new Set<SerialState>(['SHIPPED', 'STAGED' /* unload */]),
  SHIPPED:     new Set<SerialState>(['RETURNED']),
  RETURNED:    new Set<SerialState>(['TRIAGED', 'STOCKED', 'RMA', 'SCRAPPED']),
  RMA:         new Set<SerialState>(['SCRAPPED', 'RETURNED']),
  SCRAPPED:    new Set<SerialState>([]), // terminal
  // Release-from-hold restores the pre-hold state. The destination is dynamic
  // (recovered from the unit's HELD event, or an operator force_status), but it
  // is ALWAYS one of hold.ts' RESTORABLE_STATUSES — so model exactly that set as
  // ON_HOLD's outgoing edges. Entry to ON_HOLD stays universal via guard()'s
  // to===ON_HOLD special-case below; these edges are the exits.
  ON_HOLD:     new Set<SerialState>(['STOCKED', 'TRIAGED', 'IN_REPAIR', 'REPAIR_DONE', 'IN_TEST', 'GRADED', 'ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED']),
};

/**
 * Any state can transition to ON_HOLD via the hold flow (see hold.ts).
 * Release-from-hold restores the prior state, which is recorded in
 * `inventory_events.payload.restore_status` — not modeled as an edge in this
 * graph because the destination is dynamic.
 */
const HOLD_STATE: SerialState = 'ON_HOLD';

// ─── Public API ──────────────────────────────────────────────────────────────

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Synchronous pre-flight check — does NOT touch the database. Use from UI
 * code to grey out disallowed actions before submitting.
 */
export function guard(from: SerialState, to: SerialState): GuardResult {
  if (from === to) return { ok: false, reason: 'identity transition' };
  if (to === HOLD_STATE) return { ok: true }; // hold is universal-entry
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    return { ok: false, reason: `transition ${from} → ${to} not allowed` };
  }
  return { ok: true };
}

/** All states reachable from `from` (excluding ON_HOLD which is always reachable). */
export function allowedFrom(from: SerialState): readonly SerialState[] {
  const direct = Array.from(TRANSITIONS[from] ?? []);
  return [...direct, HOLD_STATE];
}

export interface TransitionInput {
  unitId: number;
  to: SerialState;
  /** Inventory event classifier (e.g., 'PICKED', 'PACKED'). */
  eventType: InventoryEventType;
  actorStaffId?: number | null;
  station?: InventoryEventStation | null;
  /** Pass to make mobile retries idempotent. */
  clientEventId?: string | null;
  notes?: string | null;
  payload?: Record<string, unknown>;
  /**
   * Optional caller-supplied expected `from` state. When provided, the
   * transition is rejected if the unit's actual state has drifted (concurrent
   * mutation). Use this for optimistic UI flows.
   */
  expectedFrom?: SerialState;

  // ── Event passthrough fields ──────────────────────────────────────────────
  // recordInventoryEvent already persists these columns; surface them here so a
  // call site that emits a richer event (receiving putaway, pick scan, etc.) can
  // route through transition() instead of hand-writing an inventory_events INSERT
  // and losing the linkage. All optional + backward-compatible.
  /** Override the event's bin_id. When omitted, defaults to the unit's current_location coerced to an integer id. Pass an explicit value (incl. null) to override. */
  binId?: number | null;
  receivingId?: number | null;
  receivingLineId?: number | null;
  stockLedgerId?: number | null;
  scanToken?: string | null;
  prevBinId?: number | null;
}

export type TransitionResult =
  | { ok: true; eventId: number; from: SerialState; to: SerialState }
  | { ok: false; status: 404 | 409; error: string; from?: SerialState };

/**
 * Atomically transition a unit's state and emit an inventory_event.
 *
 * Pass `db` to share a transaction with the caller. Without it, this function
 * opens and commits its own transaction.
 *
 * Tenancy (additive, backward-compatible): pass `orgId` to scope the unit
 * read/UPDATE to a single tenant and run the work GUC-wrapped so the
 * `inventory_events` INSERT (and any RLS-enforced table) attributes to the
 * right org.
 *   - When `orgId` is OMITTED, behavior is byte-identical to before: raw pool
 *     (or the caller-supplied `db`), no org predicate, no GUC. The many call
 *     sites that don't thread org yet keep working exactly as today.
 *   - When `orgId` is PROVIDED and `db` is OMITTED, the function runs inside
 *     `withTenantTransaction(orgId, …)` (BEGIN + `set_config('app.current_org')`
 *     + COMMIT) instead of its own bare BEGIN/COMMIT.
 *   - When `orgId` is PROVIDED and `db` is PROVIDED (executor pattern), the GUC
 *     is set on the caller's client (transaction-local) before the writes; the
 *     caller keeps owning the transaction.
 * In both org-aware modes the SELECT/UPDATE on `serial_units` get an explicit
 * `AND organization_id = $n` predicate (404 on a cross-tenant miss).
 */
export async function transition(
  input: TransitionInput,
  db?: PoolClient,
  orgId?: OrgId,
): Promise<TransitionResult> {
  // ── Org-aware, no caller transaction: run the whole thing GUC-wrapped. ──────
  // withTenantTransaction owns BEGIN/SET LOCAL/COMMIT, so the core helper must
  // NOT open its own transaction — pass useOwnTx=false and let the wrapper
  // commit/rollback. Errors propagate so the wrapper rolls back.
  if (orgId && !db) {
    return withTenantTransaction<TransitionResult>(orgId, (client) =>
      runTransition(input, client, /* useOwnTx */ false, orgId),
    );
  }

  // ── Caller-owned transaction (executor pattern), optionally org-scoped. ─────
  if (db) {
    if (orgId) {
      // Transaction-local GUC on the caller's client so the inventory_events
      // INSERT (column default reads current_setting('app.current_org')) and any
      // RLS-enforced write attribute to this org. is_local=true → auto-clears on
      // the caller's COMMIT/ROLLBACK.
      await db.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    }
    return runTransition(input, db, /* useOwnTx */ false, orgId);
  }

  // ── Legacy path: own transaction on the raw pool, no org scoping. ───────────
  const client = await pool.connect();
  try {
    return await runTransition(input, client, /* useOwnTx */ true, undefined);
  } finally {
    client.release();
  }
}

/**
 * Core transition logic over a single client. `useOwnTx` controls whether this
 * helper issues its own BEGIN/COMMIT/ROLLBACK (true only on the legacy raw-pool
 * path; the GUC wrapper and executor-pattern callers own the transaction).
 * `orgId`, when present, adds the explicit `organization_id` predicate to the
 * serial_units read/UPDATE; the GUC is set by the caller of this helper.
 */
async function runTransition(
  input: TransitionInput,
  client: Pick<PoolClient, 'query'>,
  useOwnTx: boolean,
  orgId: OrgId | undefined,
): Promise<TransitionResult> {
  try {
    if (useOwnTx) await client.query('BEGIN');

    // serial_units is tenant-owned (has organization_id). When orgId is provided
    // the lock is scoped to the tenant so a cross-tenant id reads as not-found;
    // when omitted the predicate/param are absent → byte-identical legacy SQL.
    const lockedQ = await client.query<{ current_status: SerialState; sku: string | null; current_location: string | null }>(
      orgId
        ? `SELECT current_status::text AS current_status,
                  sku,
                  current_location
             FROM serial_units
            WHERE id = $1
              AND organization_id = $2
            FOR UPDATE`
        : `SELECT current_status::text AS current_status,
                  sku,
                  current_location
             FROM serial_units
            WHERE id = $1
            FOR UPDATE`,
      orgId ? [input.unitId, orgId] : [input.unitId],
    );
    const row = lockedQ.rows[0];
    if (!row) {
      if (useOwnTx) await client.query('ROLLBACK');
      return { ok: false, status: 404, error: `serial_unit ${input.unitId} not found` };
    }

    const from = row.current_status;
    if (input.expectedFrom && input.expectedFrom !== from) {
      if (useOwnTx) await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        error: `expected from=${input.expectedFrom} but unit is in ${from}`,
        from,
      };
    }

    const guarded = guard(from, input.to);
    if (!guarded.ok) {
      if (useOwnTx) await client.query('ROLLBACK');
      return { ok: false, status: 409, error: guarded.reason, from };
    }

    await client.query(
      orgId
        ? `UPDATE serial_units
              SET current_status = $2::serial_status_enum,
                  updated_at = NOW()
            WHERE id = $1
              AND organization_id = $3`
        : `UPDATE serial_units
              SET current_status = $2::serial_status_enum,
                  updated_at = NOW()
            WHERE id = $1`,
      orgId ? [input.unitId, input.to, orgId] : [input.unitId, input.to],
    );

    // serial_units.current_location is TEXT and, by convention, can hold either a
    // bin id as a string ("42") or — in some paths — a free-text location name.
    // inventory_events.bin_id is INTEGER REFERENCES locations(id), so only coerce
    // the numeric form; a non-numeric name maps to NULL rather than blowing up the
    // INSERT with an int-cast error.
    const binId = row.current_location != null && /^\d+$/.test(row.current_location.trim())
      ? Number(row.current_location.trim())
      : null;

    // recordInventoryEvent does not (yet) take an orgId — its INSERT relies on
    // inventory_events.organization_id defaulting from current_setting(
    // 'app.current_org'), which the GUC set by transition()'s caller supplies on
    // this same client. So passing the GUC-scoped `client` is what tenant-stamps
    // the event; in the legacy (no-org) path the column default falls back to the
    // usav-fallback exactly as today.
    const event = await recordInventoryEvent(
      {
        event_type: input.eventType,
        actor_staff_id: input.actorStaffId ?? null,
        station: input.station ?? null,
        serial_unit_id: input.unitId,
        sku: row.sku,
        // Caller override wins (including an explicit null); else fall back to the
        // unit's current_location coerced to an integer bin id.
        bin_id: input.binId !== undefined ? input.binId : binId,
        prev_bin_id: input.prevBinId ?? null,
        receiving_id: input.receivingId ?? null,
        receiving_line_id: input.receivingLineId ?? null,
        stock_ledger_id: input.stockLedgerId ?? null,
        scan_token: input.scanToken ?? null,
        prev_status: from,
        next_status: input.to,
        client_event_id: input.clientEventId ?? null,
        notes: input.notes ?? null,
        payload: input.payload ?? {},
      },
      client,
    );

    if (useOwnTx) await client.query('COMMIT');
    return { ok: true, eventId: event.id, from, to: input.to };
  } catch (err) {
    if (useOwnTx) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
    }
    throw err;
  }
}
