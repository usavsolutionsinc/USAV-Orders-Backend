/**
 * applyTransition — the unified mutate-and-tap chokepoint (engine Phase 1.1).
 *
 * UNIFIED-ENGINE-MASTER-PLAN §1.1: collapse the "load → decide → guard → write
 * status → record event → tap the engine" shotgun (repeated across ~26 domain
 * handlers) into ONE helper. A domain handler becomes a pure decision fn that
 * picks `{ to, eventType, … }`; applyTransition owns the rest.
 *
 * It does NOT reinvent the guarded writer — it COMPOSES the two pieces that
 * already exist:
 *
 *   transition()   (src/lib/inventory/state-machine.ts)
 *     → FOR UPDATE lock · guard(from→to) · UPDATE serial_units · recordInventoryEvent,
 *       all atomic + org-aware (GUC-wrapped when orgId is passed).
 *   tapWorkflow()  (src/lib/workflow/tap.ts)
 *     → fire-and-forget engine observe: advances the unit's graph position.
 *
 * Idempotency: re-entering the SAME transition (unit already at `to`) is NOT an
 * error — transition() rejects it as an 'identity transition', so we record the
 * inventory event anyway (client_event_id de-dupes a true retry) and still tap,
 * mirroring the legacy hand-rolled paths that skipped the UPDATE but kept the
 * audit + engine signal. The result carries `idempotent: true` for that case.
 *
 * Reversibility/audit: every successful call writes exactly one inventory_event
 * (+ one workflow_runs row via the tap), and serial_units.current_status and the
 * graph position stay coherent. Guard rejections surface as { ok:false, 409 }.
 *
 * Collaborators are injected (defaulting to the real impls) so this is unit
 * testable with in-memory fakes — see applyTransition.test.ts, the same pattern
 * advanceItem() uses.
 */

import { transition } from '@/lib/inventory/state-machine';
import type { SerialState } from '@/lib/inventory/state-machine';
import {
  recordInventoryEvent,
  type InventoryEventStation,
  type InventoryEventType,
  type RecordInventoryEventInput,
} from '@/lib/inventory/events';
import type { OrgId } from '@/lib/tenancy/constants';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';
import { tapWorkflow, type WorkflowTapArgs, type WorkflowTapEvent } from './tap';

export interface ApplyTransitionArgs {
  /** serial_units.id */
  unitId: number;
  /** Target lifecycle state (guarded against the unit's current state). */
  to: SerialState;
  /** inventory_events classifier for this transition. */
  eventType: InventoryEventType;
  /**
   * Domain event the engine's current node is gated on (drives graph routing).
   * Required to tap; omit it together with skipTap for write-only call sites.
   */
  tapEvent?: WorkflowTapEvent;
  /** Extra payload merged into the tapped node's ctx.input (e.g. { verdict }). */
  tapInput?: Record<string, unknown>;

  actorStaffId?: number | null;
  station?: InventoryEventStation | null;
  /** Pass to make retries idempotent (UNIQUE on inventory_events). */
  clientEventId?: string | null;
  notes?: string | null;
  payload?: Record<string, unknown>;
  receivingId?: number | null;
  receivingLineId?: number | null;
  scanToken?: string | null;
  /** Pass null to keep the event's bin_id null (e.g. testing has no placement). */
  binId?: number | null;
  /** SKU for the idempotent re-entry event (the happy path reads it from the row). */
  sku?: string | null;
  /** Reject if the unit drifted from this state (optimistic concurrency). */
  expectedFrom?: SerialState;

  /** Tenant id — scopes the status write + stamps the event; enrolls the tap. */
  orgId?: OrgId | null;
  /** Who/what triggered this (defaults to 'manual'). */
  source?: WorkflowTapArgs['source'];
  /**
   * Suppress the engine tap (still does the guarded status write + atomic
   * inventory_event + idempotent-identity handling). For call sites that mutate
   * a unit's status but are NOT the canonical driver of its graph position —
   * e.g. the receiving line-status route, whose test pass/fail is already
   * tapped by recordTestVerdict, so a second tap would be redundant.
   */
  skipTap?: boolean;
}

export type ApplyTransitionResult =
  | {
      ok: true;
      status: 200;
      from: SerialState;
      to: SerialState;
      eventId: number;
      /** true when the unit was already at `to` (re-entered verdict / retry). */
      idempotent: boolean;
    }
  | { ok: false; status: 404 | 409; from?: SerialState; error: string };

/** Injectable collaborators (real impls by default; fakes in tests). */
export interface ApplyTransitionDeps {
  transition: typeof transition;
  recordEvent: (input: RecordInventoryEventInput, orgId?: OrgId) => Promise<{ id: number }>;
  tap: (args: WorkflowTapArgs) => Promise<void>;
}

const defaultDeps: ApplyTransitionDeps = {
  transition,
  recordEvent: (input, orgId) => recordInventoryEvent(input, undefined, orgId ?? USAV_ORG_ID),
  tap: tapWorkflow,
};

export async function applyTransition(
  args: ApplyTransitionArgs,
  deps: ApplyTransitionDeps = defaultDeps,
): Promise<ApplyTransitionResult> {
  const orgId = args.orgId ?? undefined;

  // 1. Guarded status write + atomic inventory_event. transition() owns the
  //    FOR UPDATE lock, the guard, and (when orgId is set) its own GUC-wrapped tx.
  const result = await deps.transition(
    {
      unitId: args.unitId,
      to: args.to,
      eventType: args.eventType,
      actorStaffId: args.actorStaffId ?? null,
      station: args.station ?? null,
      clientEventId: args.clientEventId ?? null,
      notes: args.notes ?? null,
      payload: args.payload ?? {},
      receivingId: args.receivingId ?? null,
      receivingLineId: args.receivingLineId ?? null,
      scanToken: args.scanToken ?? null,
      binId: args.binId,
      expectedFrom: args.expectedFrom,
    },
    undefined,
    orgId,
  );

  if (result.ok) {
    await tapAfter(args, deps);
    return { ok: true, status: 200, from: result.from, to: result.to, eventId: result.eventId, idempotent: false };
  }

  // 2. Identity (unit already at `to`) → idempotent re-entry. transition()
  //    classifies from===to as an 'identity transition' (409). We only treat it
  //    as a re-entry when the caller did NOT request optimistic concurrency:
  //    transition() runs the expectedFrom drift check BEFORE the guard's identity
  //    check, so with expectedFrom a 409 (even one where from===to) is a drift
  //    rejection the caller asked to fail on, not an idempotent re-entry. Record
  //    the event (client_event_id de-dupes a true retry) and still tap.
  if (args.expectedFrom === undefined && result.status === 409 && result.from === args.to) {
    const event = await deps.recordEvent(
      {
        event_type: args.eventType,
        actor_staff_id: args.actorStaffId ?? null,
        station: args.station ?? null,
        serial_unit_id: args.unitId,
        sku: args.sku ?? null,
        bin_id: args.binId ?? null,
        receiving_id: args.receivingId ?? null,
        receiving_line_id: args.receivingLineId ?? null,
        scan_token: args.scanToken ?? null,
        prev_status: result.from,
        next_status: args.to,
        client_event_id: args.clientEventId ?? null,
        notes: args.notes ?? null,
        payload: args.payload ?? {},
      },
      orgId,
    );
    await tapAfter(args, deps);
    return { ok: true, status: 200, from: result.from, to: args.to, eventId: event.id, idempotent: true };
  }

  // 3. Genuine rejection: illegal transition (409) or unit not found (404). Do
  //    NOT tap — the unit's domain state didn't change.
  return { ok: false, status: result.status, from: result.from, error: result.error };
}

/** Fire-and-forget engine observe (never throws — see tap.ts). No-op when skipTap / no tapEvent. */
async function tapAfter(args: ApplyTransitionArgs, deps: ApplyTransitionDeps): Promise<void> {
  if (args.skipTap || !args.tapEvent) return;
  await deps.tap({
    serialUnitId: args.unitId,
    event: args.tapEvent,
    input: args.tapInput,
    staffId: args.actorStaffId ?? null,
    source: args.source ?? 'manual',
    orgId: args.orgId ?? null,
  });
}
