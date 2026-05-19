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
  RECEIVED:    new Set<SerialState>(['TRIAGED', 'TESTED', 'IN_TEST', 'SCRAPPED']),
  TRIAGED:     new Set<SerialState>(['IN_REPAIR', 'IN_TEST', 'SCRAPPED']),
  IN_REPAIR:   new Set<SerialState>(['REPAIR_DONE', 'SCRAPPED']),
  REPAIR_DONE: new Set<SerialState>(['IN_TEST', 'GRADED']),
  IN_TEST:     new Set<SerialState>(['GRADED', 'IN_REPAIR', 'SCRAPPED']),
  GRADED:      new Set<SerialState>(['STOCKED', 'SCRAPPED']),
  TESTED:      new Set<SerialState>(['STOCKED', 'IN_REPAIR', 'SCRAPPED']),
  STOCKED:     new Set<SerialState>(['ALLOCATED', 'RETURNED', 'SCRAPPED']),
  ALLOCATED:   new Set<SerialState>(['PICKING', 'PICKED', 'STOCKED' /* release */]),
  PICKING:     new Set<SerialState>(['PICKED', 'ALLOCATED' /* abandon */]),
  PICKED:      new Set<SerialState>(['PACKING', 'PACKED', 'ALLOCATED' /* re-pick */]),
  PACKING:     new Set<SerialState>(['PACKED', 'PICKED' /* abandon */]),
  PACKED:      new Set<SerialState>(['LABELED', 'LOADING', 'SHIPPED']),
  LABELED:     new Set<SerialState>(['STAGED', 'LOADING', 'SHIPPED']),
  STAGED:      new Set<SerialState>(['LOADING', 'SHIPPED', 'LABELED' /* re-stage */]),
  LOADING:     new Set<SerialState>(['SHIPPED', 'STAGED' /* unload */]),
  SHIPPED:     new Set<SerialState>(['RETURNED']),
  RETURNED:    new Set<SerialState>(['TRIAGED', 'STOCKED', 'RMA', 'SCRAPPED']),
  RMA:         new Set<SerialState>(['SCRAPPED', 'RETURNED']),
  SCRAPPED:    new Set<SerialState>([]), // terminal
  ON_HOLD:     new Set<SerialState>([]), // exits handled by hold.releaseUnit(); see below.
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
}

export type TransitionResult =
  | { ok: true; eventId: number; from: SerialState; to: SerialState }
  | { ok: false; status: 404 | 409; error: string; from?: SerialState };

/**
 * Atomically transition a unit's state and emit an inventory_event.
 *
 * Pass `db` to share a transaction with the caller. Without it, this function
 * opens and commits its own transaction.
 */
export async function transition(
  input: TransitionInput,
  db?: PoolClient,
): Promise<TransitionResult> {
  const useOwnTx = !db;
  const client = db ?? (await pool.connect());

  try {
    if (useOwnTx) await client.query('BEGIN');

    const lockedQ = await client.query<{ current_status: SerialState; sku: string | null; current_location: number | null }>(
      `SELECT current_status::text AS current_status,
              sku,
              current_location
         FROM serial_units
        WHERE id = $1
        FOR UPDATE`,
      [input.unitId],
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
      `UPDATE serial_units
          SET current_status = $2::serial_status_enum,
              updated_at = NOW()
        WHERE id = $1`,
      [input.unitId, input.to],
    );

    const event = await recordInventoryEvent(
      {
        event_type: input.eventType,
        actor_staff_id: input.actorStaffId ?? null,
        station: input.station ?? null,
        serial_unit_id: input.unitId,
        sku: row.sku,
        bin_id: row.current_location ?? null,
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
  } finally {
    if (useOwnTx) (client as PoolClient).release();
  }
}
