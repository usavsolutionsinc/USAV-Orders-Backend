/**
 * unit-events.ts — the transactional unit-lifecycle façade.
 * ────────────────────────────────────────────────────────────────────
 * `recordUnitEvent()` is the single entry point for "a thing happened to a
 * serialized unit": it find-or-creates the `serial_units` master, writes the
 * `tech_serial_numbers` lineage row, optionally moves quantity via
 * `sku_stock_ledger`, and appends the linked `inventory_events` row — all on
 * ONE pg client so it commits or rolls back atomically with the caller's work.
 *
 * STATUS CHANGES ROUTE THROUGH THE STATE MACHINE (relational-reuse §2).
 * ────────────────────────────────────────────────────────────────────
 * The façade does NOT stamp `serial_units.current_status` directly. The SoT
 * rule (`.claude/rules/backend-patterns.md`) is that every status change on a
 * *pre-existing* unit goes through the guarded `transition()` chokepoint
 * (`src/lib/inventory/state-machine.ts`) so the allow-list, the `FOR UPDATE`
 * lock, optimistic-concurrency (`expectedFrom`), and the atomic
 * `serial_units` UPDATE + `inventory_events` INSERT all happen in one place.
 *
 * So the façade splits into two paths:
 *
 *   • EXISTING unit + a real status change → `transition()` owns it. We upsert
 *     identity WITHOUT moving status (pass `target_status = priorStatus`, a
 *     no-op for the upsert), then call `transition({ to, expectedFrom, … })`,
 *     which writes the guarded UPDATE + the status-transition `inventory_event`.
 *
 *   • BRAND-NEW unit (no prior status) → there is no valid `from` state for
 *     `transition()` to guard against, so the CREATE stays explicit:
 *     `upsertSerialUnit()` INSERTs the row at its birth status and the façade
 *     records the create `inventory_event` directly. This is the one path that
 *     legitimately does not flow through the state machine — a create is not a
 *     transition. (Existing units with NO status change also record their event
 *     directly, since there is nothing for the state machine to move.)
 *
 * Why NOT `applyTransition()`? `applyTransition` always opens its OWN
 * transaction (it calls `transition()` with an undefined db arg), so it
 * cannot co-commit with the façade's caller-owned pg transaction — the same
 * transport constraint that rules out the Drizzle repositories here (see
 * `tech-serial.ts`). The façade therefore composes `transition()` directly,
 * threading the shared `client` so the status write co-commits with the
 * lineage/ledger writes. The engine tap (`tapWorkflow`) is a fire-and-forget
 * side-effect a caller can fire from `after()`; it is deliberately out of this
 * atomic spine.
 *
 * Why a PoolClient (not the pool, not Drizzle): the upsert + `transition()`
 * take `FOR UPDATE` locks that the FK checks and ledger insert must see in the
 * same transaction. The Drizzle (`neon-http`) repositories run on a separate
 * stateless connection and cannot join this transaction (see the transport
 * note in `tech-serial.ts`). Callers own the transaction:
 *
 *     await transaction(async (client) => {
 *       await recordUnitEvent({ ... }, client);
 *       // ...other writes in the same txn...
 *     });
 *
 * Collaborators are injected (defaulting to the real impls) so this is unit
 * testable with in-memory fakes — see `unit-events.test.ts`, the same pattern
 * `applyTransition()` / `advanceItem()` use.
 *
 * This is the spine Phase 2 migrates the hot paths onto incrementally; new
 * unit-touching code should use it rather than hand-rolling the four inserts.
 */

import type { PoolClient } from 'pg';
import {
  upsertSerialUnit,
  normalizeSerial,
  type SerialOriginSource,
  type SerialStatus,
  type SerialUnitRow,
} from '@/lib/neon/serial-units-queries';
import type { OrgId } from '@/lib/tenancy/constants';
import { attachTechSerial, type TechSerialStationSource } from '@/lib/inventory/tech-serial';
import {
  recordInventoryEvent,
  type InventoryEventType,
  type InventoryEventStation,
} from '@/lib/inventory/events';
import { transition } from '@/lib/inventory/state-machine';

export interface UnitEventLedger {
  /** Signed quantity delta; 0 is ignored (no ledger row written). */
  delta: number;
  reason: string;
  dimension?: 'WAREHOUSE' | 'BOXED';
  reasonCodeId?: number | null;
  refOrderId?: number | null;
  refReceivingLineId?: number | null;
  notes?: string | null;
}

export interface RecordUnitEventInput {
  // ── tenant ──
  /** Owning tenant — required so the org-scoped serial_units upsert can stamp it. */
  organizationId: OrgId;

  // ── unit identity (upsert) ──
  serialNumber: string;
  sku?: string | null;
  skuCatalogId?: number | null;
  zohoItemId?: string | null;
  originSource: SerialOriginSource;
  originReceivingLineId?: number | null;
  conditionGrade?: string | null;
  /**
   * Target lifecycle status.
   *   • New unit: the birth status (defaults from originSource when omitted).
   *   • Existing unit: the state to `transition()` the unit INTO. Omit it to
   *     record an event WITHOUT moving status (e.g. a NOTE). The requested
   *     transition must be allowed by the state machine's allow-list, or the
   *     call throws (the caller's transaction rolls back).
   */
  targetStatus?: SerialStatus;

  // ── event ──
  eventType: InventoryEventType;
  station?: InventoryEventStation | null;
  actorStaffId?: number | null;
  receivingId?: number | null;
  receivingLineId?: number | null;
  notes?: string | null;
  /** UNIQUE — pass for idempotent retries. */
  clientEventId?: string | null;
  scanToken?: string | null;
  payload?: Record<string, unknown>;

  // ── tech_serial_numbers lineage (optional) ──
  /** Default true. Set false for non-serial events that shouldn't write lineage. */
  writeTechSerial?: boolean;
  techStationSource?: TechSerialStationSource;

  // ── stock movement (optional) ──
  /** Only when the event actually moves quantity. Linked to the event row. */
  ledger?: UnitEventLedger | null;
}

export interface RecordUnitEventResult {
  unit: SerialUnitRow;
  isNew: boolean;
  priorStatus: SerialStatus | null;
  isReturn: boolean;
  warnings: string[];
  techSerialId: number | null;
  ledgerId: number | null;
  eventId: number | null;
  /** True when the status change was driven through the guarded `transition()`. */
  transitioned: boolean;
}

/**
 * Injectable collaborators (real impls by default; in-memory fakes in tests so
 * the façade runs DB-free). `lookupUnit` takes the early `FOR UPDATE` lock that
 * both establishes new-vs-existing and lets us neutralize the upsert's status
 * move; `transition` is the guarded state-machine writer.
 */
export interface RecordUnitEventDeps {
  lookupUnit: (
    client: Pick<PoolClient, 'query'>,
    normalizedSerial: string,
    orgId: OrgId,
  ) => Promise<{ id: number; current_status: SerialStatus } | null>;
  upsertSerialUnit: typeof upsertSerialUnit;
  attachTechSerial: typeof attachTechSerial;
  recordInventoryEvent: typeof recordInventoryEvent;
  transition: typeof transition;
}

/** Default lock+read: tenant-scoped `FOR UPDATE` on serial_units by serial. */
async function defaultLookupUnit(
  client: Pick<PoolClient, 'query'>,
  normalizedSerial: string,
  orgId: OrgId,
): Promise<{ id: number; current_status: SerialStatus } | null> {
  const res = await client.query<{ id: number; current_status: SerialStatus }>(
    `SELECT id, current_status::text AS current_status
       FROM serial_units
      WHERE normalized_serial = $1 AND organization_id = $2
      FOR UPDATE`,
    [normalizedSerial, orgId],
  );
  return res.rows[0] ?? null;
}

const defaultDeps: RecordUnitEventDeps = {
  lookupUnit: defaultLookupUnit,
  upsertSerialUnit,
  attachTechSerial,
  recordInventoryEvent,
  transition,
};

/**
 * Atomically find-or-create a unit + write its lineage/ledger/event rows on the
 * given transaction client. Status changes on an EXISTING unit are routed
 * through the guarded `transition()` state machine (a brand-new-unit create is
 * stamped at birth — there is no prior state to transition from). Throws if the
 * serial is invalid OR the requested transition is rejected by the state
 * machine (rolls back via the caller's transaction). Idempotent on
 * `clientEventId` at the event layer.
 */
export async function recordUnitEvent(
  input: RecordUnitEventInput,
  client: PoolClient,
  deps: RecordUnitEventDeps = defaultDeps,
): Promise<RecordUnitEventResult> {
  const normalized = normalizeSerial(input.serialNumber);
  if (!normalized) throw new Error('recordUnitEvent: invalid serial number');

  // 0. Lock + classify. The early FOR UPDATE both tells us new-vs-existing and
  //    holds the row so the upsert below and (for existing units) transition()
  //    operate on a stable prior state — `expectedFrom` can never lose a race.
  const existing = await deps.lookupUnit(client, normalized, input.organizationId);
  const priorStatus: SerialStatus | null = existing?.current_status ?? null;

  // 1. Upsert the unit master.
  //    • EXISTING unit: pass target_status = priorStatus so the upsert ONLY
  //      backfills identity (sku / catalog / zoho / grade / origin / unit_uid)
  //      and leaves current_status untouched — the state machine owns the move.
  //    • NEW unit: pass the requested target (or let it default from origin) so
  //      the INSERT stamps the birth status. transition() can't guard a create
  //      (no from-state), so the create is explicit by design.
  const upsertTargetStatus = existing ? priorStatus ?? undefined : input.targetStatus;
  const upserted = await deps.upsertSerialUnit(
    {
      serial_number: input.serialNumber,
      sku: input.sku ?? null,
      sku_catalog_id: input.skuCatalogId ?? null,
      zoho_item_id: input.zohoItemId ?? null,
      origin_source: input.originSource,
      origin_receiving_line_id: input.originReceivingLineId ?? null,
      actor_id: input.actorStaffId ?? null,
      condition_grade: input.conditionGrade ?? null,
      target_status: upsertTargetStatus,
    },
    { dbClient: client },
    input.organizationId,
  );
  if (!upserted) throw new Error('recordUnitEvent: invalid serial number');

  const unitId = upserted.unit.id;
  const effectiveSku = input.sku ?? upserted.unit.sku ?? null;

  // 2. Lineage row (default on). Shares the client → atomic with the upsert.
  let techSerialId: number | null = null;
  if (input.writeTechSerial !== false) {
    const tsn = await deps.attachTechSerial(
      {
        serialNumber: input.serialNumber,
        serialUnitId: unitId,
        stationSource:
          input.techStationSource ?? (input.station === 'RECEIVING' ? 'RECEIVING' : 'TECH'),
        testedBy: input.actorStaffId ?? null,
        receivingLineId: input.receivingLineId ?? null,
      },
      client,
    );
    techSerialId = tsn.id;
  }

  // 3. Optional stock delta — only when the event moves quantity AND we know the
  //    SKU. Written before the event so the event can link it.
  let ledgerId: number | null = null;
  if (input.ledger && input.ledger.delta !== 0 && effectiveSku) {
    const led = await client.query<{ id: number }>(
      `INSERT INTO sku_stock_ledger
         (organization_id, sku, delta, reason, dimension, reason_code_id, staff_id,
          ref_serial_unit_id, ref_order_id, ref_receiving_line_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        input.organizationId,
        effectiveSku,
        input.ledger.delta,
        input.ledger.reason,
        input.ledger.dimension ?? 'WAREHOUSE',
        input.ledger.reasonCodeId ?? null,
        input.actorStaffId ?? null,
        unitId,
        input.ledger.refOrderId ?? null,
        input.ledger.refReceivingLineId ?? null,
        input.ledger.notes ?? null,
      ],
    );
    ledgerId = led.rows[0]?.id ?? null;
  }

  // 4. The lifecycle event.
  //
  //    Status-change path (EXISTING unit, requested target differs from prior):
  //    drive it through the guarded transition(). transition() owns the
  //    FOR UPDATE re-check, the allow-list guard, the serial_units UPDATE, and
  //    the status-transition inventory_event — all on THIS client (co-commit).
  //    We thread the ledger link + event passthrough so the emitted event is
  //    identical to what the façade used to write by hand. A rejected
  //    transition (404/409) throws so the caller's transaction rolls back.
  const wantsStatusChange =
    existing != null && input.targetStatus != null && input.targetStatus !== priorStatus;

  // SHIPPED → RETURNED is the canonical return move (the caller must request
  // RETURNED explicitly now; the old implicit upsert flip is gone by design).
  const isReturn = wantsStatusChange && priorStatus === 'SHIPPED' && input.targetStatus === 'RETURNED';

  let eventId: number | null = null;
  let transitioned = false;

  if (wantsStatusChange) {
    const result = await deps.transition(
      {
        unitId,
        to: input.targetStatus!, // SerialStatus ⊂ SerialState
        eventType: input.eventType,
        actorStaffId: input.actorStaffId ?? null,
        station: input.station ?? null,
        clientEventId: input.clientEventId ?? null,
        notes: input.notes ?? null,
        payload: { ...(input.payload ?? {}), is_return: isReturn },
        receivingId: input.receivingId ?? null,
        receivingLineId: input.receivingLineId ?? null,
        scanToken: input.scanToken ?? null,
        stockLedgerId: ledgerId,
        expectedFrom: priorStatus ?? undefined, // SerialStatus ⊂ SerialState — 409-safe
      },
      client,
      input.organizationId,
    );
    if (!result.ok) {
      throw new Error(
        `recordUnitEvent: transition ${priorStatus} → ${input.targetStatus} rejected ` +
          `(${result.status}): ${result.error}`,
      );
    }
    eventId = result.eventId;
    transitioned = true;
  } else {
    // No status move to guard: a brand-new-unit CREATE (stamped at birth above),
    // or an existing unit recording an event without changing status. Write the
    // event directly, linked to the ledger row when one was written.
    const nextStatus = existing
      ? input.targetStatus ?? priorStatus ?? upserted.unit.current_status
      : upserted.unit.current_status;
    const event = await deps.recordInventoryEvent(
      {
        event_type: input.eventType,
        actor_staff_id: input.actorStaffId ?? null,
        station: input.station ?? null,
        receiving_id: input.receivingId ?? null,
        receiving_line_id: input.receivingLineId ?? null,
        serial_unit_id: unitId,
        sku: effectiveSku,
        prev_status: priorStatus,
        next_status: nextStatus,
        stock_ledger_id: ledgerId,
        scan_token: input.scanToken ?? null,
        client_event_id: input.clientEventId ?? null,
        notes: input.notes ?? null,
        payload: { ...(input.payload ?? {}), is_return: isReturn },
      },
      client,
      input.organizationId,
    );
    eventId = event.id;
  }

  return {
    unit: upserted.unit,
    isNew: upserted.is_new,
    priorStatus,
    isReturn,
    warnings: upserted.warnings,
    techSerialId,
    ledgerId,
    eventId,
    transitioned,
  };
}
