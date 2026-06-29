/**
 * recordDataWipe — the per-unit secure data-erasure / factory-reset action, the
 * compliance gate that defines ELECTRONICS/AV refurb (see the electronics-av-refurb
 * workflow template + src/lib/workflow/nodes/data-wipe.node.ts).
 *
 * UNLIKE recordTestVerdict, a wipe does NOT change serial_units.current_status —
 * the unit is already TESTED and stays sellable-pending; the wipe is a recorded
 * compliance fact + a graph advance, not a lifecycle status transition. So this
 * helper has no state-machine/guard path: it
 *
 *   1. records a DATA_WIPED inventory_event (idempotent on clientEventId), and
 *   2. taps the workflow engine `data_wiped` so the run advances
 *        wipeSuccess === true  → 'wiped'  → grade-route
 *        wipeSuccess === false → 'failed' → repair (a non-wipeable device is
 *                                            usually itself faulty → diagnose).
 *
 * The tap carries `expectNodeType: 'data_wipe'` so a stray event can't advance a
 * unit that isn't actually at the wipe node, and is fire-and-forget (drops
 * unenrolled units; never throws — an engine error never fails the wipe record).
 *
 * Deps-injected (default real impls) so the unit test runs DB-free
 * (backend-patterns.md → "Dependency injection for testability").
 */

import pool from '@/lib/db';
import { appendInventoryEvent } from '@/lib/repositories/inventory/inventoryEvents';
import { tapWorkflow } from '@/lib/workflow/tap';
import type { TestedUnit } from './recordTestVerdict';

/** Erasure methods the bench can record (mirrors the node config `methods`). */
export const WIPE_METHODS = ['factory_reset', 'secure_erase', 'crypto_erase'] as const;
export type WipeMethod = (typeof WIPE_METHODS)[number];

export interface RecordDataWipeArgs {
  serialUnitId: number;
  wipeSuccess: boolean;
  /** Erasure method performed; null when not captured. */
  wipeMethod?: WipeMethod | null;
  /** Optional certificate / audit reference for the erasure. */
  wipeCertRef?: string | null;
  /** Already trimmed/capped by the caller. */
  notes?: string | null;
  clientEventId?: string | null;
  actorStaffId?: number | null;
  /** Tenant id (ctx.organizationId) — org-scopes the read + threads to the tap. */
  organizationId?: string | null;
}

export interface RecordDataWipeResult {
  unit: TestedUnit;
  eventId: number;
  wipeSuccess: boolean;
  /** true when this was a retry that re-hit the same client_event_id. */
  idempotent: boolean;
}

export interface RecordDataWipeDeps {
  fetchUnit(serialUnitId: number, orgId: string | null): Promise<TestedUnit | null>;
  appendEvent: typeof appendInventoryEvent;
  tap: typeof tapWorkflow;
}

export const defaultDataWipeDeps: RecordDataWipeDeps = {
  fetchUnit: async (serialUnitId, orgId) => {
    // org-scoped read; `pool` is the BYPASSRLS owner connection so this explicit
    // predicate (not RLS) isolates tenants — mirrors recordTestVerdict.
    const r = await pool.query<TestedUnit>(
      orgId
        ? `SELECT id, serial_number, current_status::text AS current_status, sku,
                  origin_receiving_line_id, organization_id
             FROM serial_units WHERE id = $1 AND organization_id = $2`
        : `SELECT id, serial_number, current_status::text AS current_status, sku,
                  origin_receiving_line_id, organization_id
             FROM serial_units WHERE id = $1`,
      orgId ? [serialUnitId, orgId] : [serialUnitId],
    );
    return r.rows[0] ?? null;
  },
  appendEvent: appendInventoryEvent,
  tap: tapWorkflow,
};

/** Returns null when the serial unit doesn't exist (or is another tenant's). */
export async function recordDataWipe(
  args: RecordDataWipeArgs,
  deps: RecordDataWipeDeps = defaultDataWipeDeps,
): Promise<RecordDataWipeResult | null> {
  const orgId = args.organizationId ?? null;
  const unit = await deps.fetchUnit(args.serialUnitId, orgId);
  if (!unit) return null;

  const payload = {
    wipeSuccess: args.wipeSuccess,
    wipeMethod: args.wipeMethod ?? null,
    wipeCertRef: args.wipeCertRef ?? null,
  };

  // 1. Record the wipe on the unit timeline. prevStatus === nextStatus because the
  //    wipe leaves current_status unchanged (compliance gate, not a transition).
  const { event, created } = await deps.appendEvent({
    eventType: 'DATA_WIPED',
    organizationId: orgId,
    clientEventId: args.clientEventId ?? null,
    actorStaffId: args.actorStaffId ?? null,
    station: 'TECH',
    serialUnitId: unit.id,
    receivingLineId: unit.origin_receiving_line_id,
    sku: unit.sku,
    prevStatus: unit.current_status,
    nextStatus: unit.current_status,
    notes: args.notes ?? null,
    payload,
  });

  // 2. Advance the graph (wiped → grade, failed → repair). Position-guarded to the
  //    data_wipe node; fire-and-forget; never throws (tap.ts catches + logs).
  await deps.tap({
    serialUnitId: unit.id,
    event: 'data_wiped',
    input: payload,
    staffId: args.actorStaffId ?? null,
    source: 'manual',
    orgId,
    expectNodeType: 'data_wipe',
  });

  return { unit, eventId: event.id, wipeSuccess: args.wipeSuccess, idempotent: !created };
}
