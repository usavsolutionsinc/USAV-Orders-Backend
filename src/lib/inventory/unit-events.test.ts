/**
 * Orchestration guards for recordUnitEvent() — the transactional unit
 * lifecycle façade (relational-reuse plan, §2).
 *
 * The façade now routes STATUS CHANGES through the guarded transition() state
 * machine instead of stamping current_status via upsertSerialUnit({target_status}).
 * These tests inject in-memory fakes (no DB) and assert:
 *   • an EXISTING unit's status change is driven through transition(), with the
 *     upsert neutralized (target_status = priorStatus) so it only backfills
 *     identity, and the ledger row linked into the transition event;
 *   • a BRAND-NEW unit create stays explicit — recordInventoryEvent directly,
 *     no transition() (there is no from-state to guard);
 *   • an existing unit with NO status change records its event directly;
 *   • a rejected transition (404/409) throws (caller txn rolls back);
 *   • the optional tech/ledger composite writes fire / skip as requested.
 */

import { test } from 'node:test';
import { equal, ok, deepEqual } from 'node:assert/strict';
import type { PoolClient } from 'pg';
import {
  recordUnitEvent,
  type RecordUnitEventDeps,
} from './unit-events';
import type {
  SerialStatus,
  SerialUnitRow,
  UpsertSerialUnitInput,
  UpsertSerialUnitResult,
} from '@/lib/neon/serial-units-queries';
import type { TransitionInput, TransitionResult } from '@/lib/inventory/state-machine';
import type { AttachTechSerialInput } from '@/lib/inventory/tech-serial';
import type { RecordInventoryEventInput, InventoryEventRow } from '@/lib/inventory/events';

const ORG = '00000000-0000-0000-0000-000000000001';

function makeUnit(id: number, status: SerialStatus, sku: string | null = 'SKU1'): SerialUnitRow {
  return {
    id,
    serial_number: 'SN1',
    normalized_serial: 'SN1',
    sku,
    sku_catalog_id: null,
    unit_uid: null,
    zoho_item_id: null,
    current_status: status,
    current_location: null,
    condition_grade: null,
    origin_source: 'receiving',
    origin_receiving_line_id: 9,
    origin_tsn_id: null,
    origin_sku_id: null,
    received_at: null,
    received_by: null,
    notes: null,
    metadata: {},
    created_at: '2026-06-06T00:00:00Z',
    updated_at: '2026-06-06T00:00:00Z',
  };
}

interface LedgerCall { text: string; params: unknown[]; }

interface Captured {
  lookups: Array<{ normalized: string; orgId: string }>;
  upserts: UpsertSerialUnitInput[];
  upsertOrgs: string[];
  attaches: AttachTechSerialInput[];
  transitions: TransitionInput[];
  transitionOrgs: Array<string | undefined>;
  events: RecordInventoryEventInput[];
  ledgerWrites: LedgerCall[];
}

interface FakeSetup {
  /** Pre-existing unit returned by lookupUnit, or null for a new-unit path. */
  existing?: { id: number; current_status: SerialStatus } | null;
  upsertResult: UpsertSerialUnitResult;
  transitionResult?: TransitionResult;
  eventId?: number;
  ledgerId?: number;
}

function fakes(setup: FakeSetup) {
  const cap: Captured = {
    lookups: [],
    upserts: [],
    upsertOrgs: [],
    attaches: [],
    transitions: [],
    transitionOrgs: [],
    events: [],
    ledgerWrites: [],
  };

  const deps: RecordUnitEventDeps = {
    lookupUnit: async (_client, normalized, orgId) => {
      cap.lookups.push({ normalized, orgId });
      return setup.existing ?? null;
    },
    upsertSerialUnit: (async (input: UpsertSerialUnitInput, _opts: unknown, orgId: string) => {
      cap.upserts.push(input);
      cap.upsertOrgs.push(orgId);
      return setup.upsertResult;
    }) as RecordUnitEventDeps['upsertSerialUnit'],
    attachTechSerial: (async (input: AttachTechSerialInput) => {
      cap.attaches.push(input);
      return { id: 201 };
    }) as RecordUnitEventDeps['attachTechSerial'],
    transition: (async (input: TransitionInput, _db: unknown, orgId?: string) => {
      cap.transitions.push(input);
      cap.transitionOrgs.push(orgId);
      return (
        setup.transitionResult ?? { ok: true, eventId: setup.eventId ?? 401, from: input.expectedFrom ?? 'RECEIVED', to: input.to }
      );
    }) as RecordUnitEventDeps['transition'],
    recordInventoryEvent: (async (input: RecordInventoryEventInput) => {
      cap.events.push(input);
      return { id: setup.eventId ?? 401 } as InventoryEventRow;
    }) as RecordUnitEventDeps['recordInventoryEvent'],
  };

  // Minimal fake pg client: only the direct sku_stock_ledger INSERT touches it.
  const client = {
    async query<T>(text: string, params?: unknown[]) {
      cap.ledgerWrites.push({ text, params: params ?? [] });
      if (/INSERT INTO sku_stock_ledger/.test(text)) {
        return { rows: [{ id: setup.ledgerId ?? 301 }] as T[], rowCount: 1 };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  } as unknown as PoolClient;

  return { deps, cap, client };
}

test('existing unit: status change is driven through the injected transition(), upsert neutralized', async () => {
  const { deps, cap, client } = fakes({
    existing: { id: 1, current_status: 'RECEIVED' },
    upsertResult: { unit: makeUnit(1, 'RECEIVED'), is_new: false, prior_status: 'RECEIVED', is_return: false, warnings: [] },
    transitionResult: { ok: true, eventId: 401, from: 'RECEIVED', to: 'STOCKED' },
    ledgerId: 301,
  });

  const result = await recordUnitEvent(
    {
      organizationId: ORG,
      serialNumber: 'sn1',
      sku: 'SKU1',
      originSource: 'receiving',
      eventType: 'PUTAWAY',
      station: 'RECEIVING',
      actorStaffId: 7,
      receivingLineId: 9,
      targetStatus: 'STOCKED',
      clientEventId: 'evt-1',
      ledger: { delta: 1, reason: 'PUTAWAY', refReceivingLineId: 9 },
    },
    client,
    deps,
  );

  // Routed through the state machine.
  equal(result.transitioned, true);
  equal(result.eventId, 401);
  equal(result.priorStatus, 'RECEIVED');
  equal(result.techSerialId, 201);
  equal(result.ledgerId, 301);
  equal(cap.events.length, 0, 'no direct event on the status-change path');

  // transition() captured the move with 409-safe expectedFrom + ledger link.
  equal(cap.transitions.length, 1);
  const ti = cap.transitions[0];
  equal(ti.unitId, 1);
  equal(ti.to, 'STOCKED');
  equal(ti.eventType, 'PUTAWAY');
  equal(ti.expectedFrom, 'RECEIVED');
  equal(ti.stockLedgerId, 301, 'ledger row linked into the transition event');
  equal(ti.clientEventId, 'evt-1');
  equal(ti.receivingLineId, 9);
  equal(cap.transitionOrgs[0], ORG);

  // The upsert was neutralized — it only backfills identity, status stays put.
  equal(cap.upserts.length, 1);
  equal(cap.upserts[0].target_status, 'RECEIVED', 'upsert target_status = priorStatus (no status move)');
  equal(cap.upsertOrgs[0], ORG);

  // The lock+classify read happened first.
  equal(cap.lookups.length, 1);
  equal(cap.lookups[0].orgId, ORG);
});

test('new unit: create stays explicit — direct event, no transition()', async () => {
  const { deps, cap, client } = fakes({
    existing: null,
    upsertResult: { unit: makeUnit(5, 'RECEIVED'), is_new: true, prior_status: null, is_return: false, warnings: [] },
    eventId: 401,
    ledgerId: 301,
  });

  const result = await recordUnitEvent(
    {
      organizationId: ORG,
      serialNumber: 'sn1',
      sku: 'SKU1',
      originSource: 'receiving',
      eventType: 'RECEIVED',
      station: 'RECEIVING',
      actorStaffId: 7,
      receivingLineId: 9,
      targetStatus: 'RECEIVED',
      ledger: { delta: 1, reason: 'RECEIVED', refReceivingLineId: 9 },
    },
    client,
    deps,
  );

  equal(result.isNew, true);
  equal(result.transitioned, false);
  equal(result.eventId, 401);
  equal(result.priorStatus, null);
  equal(result.techSerialId, 201);
  equal(result.ledgerId, 301);

  // No state-machine call for a create.
  equal(cap.transitions.length, 0, 'a create is not a transition');

  // The birth status was stamped by the upsert (target passed through).
  equal(cap.upserts[0].target_status, 'RECEIVED');

  // The create event was written directly, linked to the ledger row.
  equal(cap.events.length, 1);
  const ev = cap.events[0];
  equal(ev.serial_unit_id, 5);
  equal(ev.prev_status, null);
  equal(ev.next_status, 'RECEIVED');
  equal(ev.stock_ledger_id, 301, 'create event linked to the ledger row');
  equal(ev.sku, 'SKU1');
});

test('existing unit, no status change: records event directly, skips tech + ledger', async () => {
  const { deps, cap, client } = fakes({
    existing: { id: 1, current_status: 'STOCKED' },
    upsertResult: { unit: makeUnit(1, 'STOCKED'), is_new: false, prior_status: 'STOCKED', is_return: false, warnings: [] },
    eventId: 401,
  });

  const result = await recordUnitEvent(
    {
      organizationId: ORG,
      serialNumber: 'sn1',
      sku: 'SKU1',
      originSource: 'manual',
      eventType: 'NOTE',
      station: 'SYSTEM',
      writeTechSerial: false,
      // no targetStatus → no status move; no ledger
    },
    client,
    deps,
  );

  equal(result.transitioned, false);
  equal(result.techSerialId, null);
  equal(result.ledgerId, null);
  equal(result.eventId, 401);
  equal(cap.transitions.length, 0);
  equal(cap.attaches.length, 0, 'no lineage row written');
  ok(!cap.ledgerWrites.some((c) => /INSERT INTO sku_stock_ledger/.test(c.text)), 'no ledger row written');
  equal(cap.events.length, 1);
  equal(cap.events[0].prev_status, 'STOCKED');
  equal(cap.events[0].next_status, 'STOCKED');
  equal(cap.events[0].stock_ledger_id, null, 'event has no stock_ledger link');
});

test('existing unit: SHIPPED → RETURNED flags isReturn through the transition payload', async () => {
  const { deps, cap, client } = fakes({
    existing: { id: 1, current_status: 'SHIPPED' },
    upsertResult: { unit: makeUnit(1, 'SHIPPED'), is_new: false, prior_status: 'SHIPPED', is_return: false, warnings: [] },
    transitionResult: { ok: true, eventId: 402, from: 'SHIPPED', to: 'RETURNED' },
  });

  const result = await recordUnitEvent(
    {
      organizationId: ORG,
      serialNumber: 'sn1',
      originSource: 'receiving',
      eventType: 'RETURNED',
      station: 'RECEIVING',
      targetStatus: 'RETURNED',
    },
    client,
    deps,
  );

  equal(result.transitioned, true);
  equal(result.isReturn, true);
  const ti = cap.transitions[0];
  equal(ti.to, 'RETURNED');
  equal(ti.expectedFrom, 'SHIPPED');
  equal((ti.payload as { is_return?: boolean }).is_return, true);
});

test('rejected transition (409) throws so the caller transaction rolls back', async () => {
  const { deps, client } = fakes({
    existing: { id: 1, current_status: 'SHIPPED' },
    upsertResult: { unit: makeUnit(1, 'SHIPPED'), is_new: false, prior_status: 'SHIPPED', is_return: false, warnings: [] },
    transitionResult: { ok: false, status: 409, from: 'SHIPPED', error: 'transition SHIPPED → STOCKED not allowed' },
  });

  let threw = false;
  try {
    await recordUnitEvent(
      {
        organizationId: ORG,
        serialNumber: 'sn1',
        originSource: 'manual',
        eventType: 'PUTAWAY',
        targetStatus: 'STOCKED',
      },
      client,
      deps,
    );
  } catch {
    threw = true;
  }
  ok(threw, 'a rejected transition must throw');
});

test('invalid serial throws before any write', async () => {
  const { deps, cap, client } = fakes({
    existing: null,
    upsertResult: { unit: makeUnit(1, 'RECEIVED'), is_new: true, prior_status: null, is_return: false, warnings: [] },
  });

  let threw = false;
  try {
    await recordUnitEvent(
      { organizationId: ORG, serialNumber: '   ', originSource: 'manual', eventType: 'NOTE' },
      client,
      deps,
    );
  } catch {
    threw = true;
  }
  ok(threw, 'invalid serial must throw');
  equal(cap.lookups.length, 0, 'no lookup on invalid serial');
  equal(cap.upserts.length, 0, 'no upsert on invalid serial');
  equal(cap.transitions.length, 0);
  equal(cap.events.length, 0);
});
