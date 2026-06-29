import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runSubstituteOrderUnit,
  runDecideAmendment,
  type SubstituteDeps,
  type SubstituteOrderUnitInput,
} from './substitution';
import type { OrgId } from '@/lib/tenancy/constants';
import type { TransitionInput, TransitionResult } from '@/lib/inventory/state-machine';

const ORG = 'org-1' as OrgId;

// ─── Fake DB client ──────────────────────────────────────────────────────────
// Routes each SQL the helper issues to a configurable row set and captures every
// call so we can assert on the amendment INSERT params without a database.

interface Scenario {
  origAlloc?: { id: number; order_id: number; serial_unit_id: number; state: string } | null;
  origUnit?: { sku: string | null; condition_grade: string | null };
  subUnit?: { sku: string | null; condition_grade: string | null } | null;
  subTaken?: boolean;
  newAllocId?: number;
  amendmentId?: number;
  priorAmendment?: Record<string, unknown> | null;
  amendRow?: Record<string, unknown> | null;
}

interface Call { sql: string; params: unknown[] }

function fakeClient(s: Scenario) {
  const calls: Call[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM order_unit_amendments')) {
      if (sql.includes('FOR UPDATE')) return { rows: s.amendRow ? [s.amendRow] : [] };
      return { rows: s.priorAmendment ? [s.priorAmendment] : [] };
    }
    if (sql.includes('FROM order_unit_allocations') && sql.includes('state::text AS state')) {
      const row = s.origAlloc === undefined
        ? { id: 10, order_id: 77, serial_unit_id: 200, state: 'ALLOCATED' }
        : s.origAlloc;
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('SELECT sku, condition_grade::text') && !sql.includes('FOR UPDATE')) {
      return { rows: [s.origUnit ?? { sku: 'SKU-BLACK', condition_grade: 'USED_A' }] };
    }
    if (sql.includes('SELECT sku, condition_grade::text') && sql.includes('FOR UPDATE')) {
      const row = s.subUnit === undefined ? { sku: 'SKU-WHITE', condition_grade: 'USED_B' } : s.subUnit;
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("state NOT IN ('RELEASED', 'SHIPPED')")) {
      return { rows: s.subTaken ? [{ id: 999 }] : [] };
    }
    if (sql.includes("SET state = 'RELEASED'")) return { rows: [] };
    if (sql.includes('INSERT INTO order_unit_allocations')) return { rows: [{ id: s.newAllocId ?? 11 }] };
    if (sql.includes('INSERT INTO order_unit_amendments')) return { rows: [{ id: s.amendmentId ?? 55 }] };
    return { rows: [] };
  };
  return { client: { query } as never, calls };
}

function fakeTransition(results?: TransitionResult[]) {
  const inputs: TransitionInput[] = [];
  const orgs: Array<string | undefined> = [];
  let i = 0;
  const fn = (async (input: TransitionInput, _db: unknown, orgId?: string) => {
    inputs.push(input);
    orgs.push(orgId);
    return results?.[i++] ?? { ok: true, eventId: 100 + i, from: 'X', to: input.to };
  }) as SubstituteDeps['transition'];
  return { fn, inputs, orgs };
}

const baseInput: SubstituteOrderUnitInput = {
  originalAllocationId: 10,
  substituteUnitId: 201,
  reasonCode: 'CUSTOMER_REQUEST',
  customerRequestNote: 'customer asked for white',
  raisedAtNode: 'pack',
  actorStaffId: 7,
  clientEventId: 'evt-1',
};

function amendmentCall(calls: Call[]): Call {
  const c = calls.find((x) => x.sql.includes('INSERT INTO order_unit_amendments'));
  assert.ok(c, 'expected an order_unit_amendments INSERT');
  return c!;
}

test('substitute: advisory happy path re-allocates and records APPLIED amendment', async () => {
  const { client, calls } = fakeClient({});
  const { fn, inputs, orgs } = fakeTransition();

  const out = await runSubstituteOrderUnit(baseInput, client, ORG, { transition: fn });

  assert.ok(out.ok, 'expected ok');
  if (!out.ok) return;
  assert.equal(out.status, 'APPLIED');
  assert.equal(out.amendmentId, 55);
  assert.equal(out.substituteAllocationId, 11);
  assert.equal(out.orderId, 77);
  assert.deepEqual(out.original, { unitId: 200, sku: 'SKU-BLACK', condition: 'USED_A' });
  assert.deepEqual(out.fulfilled, { unitId: 201, sku: 'SKU-WHITE', condition: 'USED_B' });

  // Two transitions: release the original (→ STOCKED), allocate the substitute (→ ALLOCATED).
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].unitId, 200);
  assert.equal(inputs[0].to, 'STOCKED');
  assert.equal(inputs[1].unitId, 201);
  assert.equal(inputs[1].to, 'ALLOCATED');
  // Org threaded into the guarded writer.
  assert.equal(orgs[0], ORG);
  assert.equal(orgs[1], ORG);
  // Per-scan idempotency suffixes so a retry is a no-op.
  assert.equal(inputs[0].clientEventId, 'evt-1:release');
  assert.equal(inputs[1].clientEventId, 'evt-1:allocate');

  // Amendment row captures the ordered-vs-fulfilled delta + provenance.
  const p = amendmentCall(calls).params;
  assert.equal(p[1], 77, 'order_id');
  assert.equal(p[3], 200, 'original_unit_id');
  assert.equal(p[4], 'SKU-BLACK', 'original_sku');
  assert.equal(p[7], 201, 'substitute_unit_id');
  assert.equal(p[8], 'SKU-WHITE', 'fulfilled_sku');
  assert.equal(p[10], 'CUSTOMER_REQUEST', 'reason_code');
  assert.equal(p[11], 'customer asked for white', 'customer_request_note');
  assert.equal(p[13], 'pack', 'raised_at_node');
  assert.equal(p[14], 'APPLIED', 'status');
  assert.equal(p[15], 7, 'raised_by');
  assert.equal(p[16], 'evt-1', 'client_event_id');
});

test('substitute: idempotent replay returns the prior amendment without mutating', async () => {
  const prior = {
    id: 55, order_id: 77, substitute_allocation_id: 11, status: 'APPLIED',
    original_unit_id: 200, original_sku: 'SKU-BLACK', original_condition: 'USED_A',
    substitute_unit_id: 201, fulfilled_sku: 'SKU-WHITE', fulfilled_condition: 'USED_B',
  };
  const { client, calls } = fakeClient({ priorAmendment: prior });
  const { fn, inputs } = fakeTransition();

  const out = await runSubstituteOrderUnit(baseInput, client, ORG, { transition: fn });

  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.idempotent, true);
  assert.equal(out.amendmentId, 55);
  assert.equal(out.status, 'APPLIED');
  assert.deepEqual(out.fulfilled, { unitId: 201, sku: 'SKU-WHITE', condition: 'USED_B' });
  assert.equal(inputs.length, 0, 'a replay never re-transitions');
  assert.equal(calls.some((c) => c.sql.includes('INSERT INTO order_unit_amendments')), false);
});

test('substitute: 409 when the allocation belongs to a different order (pre-mutation)', async () => {
  const { client, calls } = fakeClient({});
  const { fn, inputs } = fakeTransition();

  const out = await runSubstituteOrderUnit({ ...baseInput, expectedOrderId: 999 }, client, ORG, { transition: fn });

  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.status, 409);
  assert.match(out.error, /does not belong/);
  assert.equal(inputs.length, 0, 'rejected before any state change');
  assert.equal(calls.some((c) => c.sql.includes("SET state = 'RELEASED'")), false);
});

test('substitute: block_until_approved records a PENDING amendment', async () => {
  const { client, calls } = fakeClient({});
  const { fn } = fakeTransition();

  const out = await runSubstituteOrderUnit(
    { ...baseInput, enforcement: 'block_until_approved' },
    client,
    ORG,
    { transition: fn },
  );

  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.status, 'PENDING');
  assert.equal(amendmentCall(calls).params[14], 'PENDING');
});

test('substitute: 404 when the original allocation is missing', async () => {
  const { client } = fakeClient({ origAlloc: null });
  const { fn } = fakeTransition();
  const out = await runSubstituteOrderUnit(baseInput, client, ORG, { transition: fn });
  assert.deepEqual(out, { ok: false, status: 404, error: 'allocation 10 not found' });
});

test('substitute: 409 when the original allocation already shipped', async () => {
  const { client } = fakeClient({ origAlloc: { id: 10, order_id: 77, serial_unit_id: 200, state: 'SHIPPED' } });
  const { fn, inputs } = fakeTransition();
  const out = await runSubstituteOrderUnit(baseInput, client, ORG, { transition: fn });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.status, 409);
  assert.equal(inputs.length, 0, 'no state change on a rejected substitution');
});

test('substitute: 409 when substitute equals the original unit', async () => {
  const { client } = fakeClient({});
  const { fn } = fakeTransition();
  const out = await runSubstituteOrderUnit({ ...baseInput, substituteUnitId: 200 }, client, ORG, { transition: fn });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.status, 409);
});

test('substitute: 409 when the substitute unit is already allocated', async () => {
  const { client } = fakeClient({ subTaken: true });
  const { fn, inputs } = fakeTransition();
  const out = await runSubstituteOrderUnit(baseInput, client, ORG, { transition: fn });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.status, 409);
  assert.match(out.error, /already allocated/);
  assert.equal(inputs.length, 0);
});

test('substitute: propagates a failed release transition and never allocates', async () => {
  const { client, calls } = fakeClient({});
  const { fn, inputs } = fakeTransition([{ ok: false, status: 409, error: 'unit not releasable' }]);
  const out = await runSubstituteOrderUnit(baseInput, client, ORG, { transition: fn });
  assert.deepEqual(out, { ok: false, status: 409, error: 'unit not releasable' });
  assert.equal(inputs.length, 1, 'stopped after the release attempt');
  assert.equal(calls.some((c) => c.sql.includes('INSERT INTO order_unit_amendments')), false);
});

// ─── decideAmendment (approve / reject) ──────────────────────────────────────

const PENDING_AMEND = {
  id: 55, order_id: 77, status: 'PENDING',
  original_unit_id: 200, substitute_unit_id: 201, substitute_allocation_id: 11,
};

function amendmentUpdate(calls: Call[]): Call {
  const c = calls.find((x) => x.sql.includes('UPDATE order_unit_amendments') && x.sql.includes('SET status'));
  assert.ok(c, 'expected an order_unit_amendments status UPDATE');
  return c!;
}

test('decide: APPROVE flips PENDING → APPROVED with no state change', async () => {
  const { client, calls } = fakeClient({ amendRow: { ...PENDING_AMEND } });
  const { fn, inputs } = fakeTransition();

  const out = await runDecideAmendment({ amendmentId: 55, decision: 'APPROVE', actorStaffId: 9 }, client, ORG, { transition: fn });

  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.status, 'APPROVED');
  assert.equal(out.orderId, 77);
  assert.equal(inputs.length, 0, 'approve never transitions units');
  const p = amendmentUpdate(calls).params;
  assert.equal(p[2], 'APPROVED');
  assert.equal(p[3], 9, 'approved_by');
});

test('decide: REJECT releases the substitute and re-allocates the original', async () => {
  const { client, calls } = fakeClient({ amendRow: { ...PENDING_AMEND } });
  const { fn, inputs } = fakeTransition();

  const out = await runDecideAmendment({ amendmentId: 55, decision: 'REJECT', actorStaffId: 9 }, client, ORG, { transition: fn });

  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.status, 'REJECTED');
  assert.equal(out.originalReallocated, true);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].unitId, 201);
  assert.equal(inputs[0].to, 'STOCKED', 'substitute released');
  assert.equal(inputs[1].unitId, 200);
  assert.equal(inputs[1].to, 'ALLOCATED', 'original restored');
  assert.ok(calls.some((c) => c.sql.includes('INSERT INTO order_unit_allocations')), 'original re-allocated');
  assert.equal(amendmentUpdate(calls).params[2], 'REJECTED');
});

test('decide: REJECT still completes when the original cannot be re-allocated', async () => {
  const { client, calls } = fakeClient({ amendRow: { ...PENDING_AMEND } });
  // release ok, re-allocate fails (original drifted out of stock).
  const { fn, inputs } = fakeTransition([
    { ok: true, eventId: 1, from: 'ALLOCATED', to: 'STOCKED' },
    { ok: false, status: 409, error: 'not stocked' },
  ]);

  const out = await runDecideAmendment({ amendmentId: 55, decision: 'REJECT', actorStaffId: 9 }, client, ORG, { transition: fn });

  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.status, 'REJECTED');
  assert.equal(out.originalReallocated, false);
  assert.equal(inputs.length, 2);
  assert.equal(calls.some((c) => c.sql.includes('INSERT INTO order_unit_allocations')), false);
});

test('decide: REJECT propagates a failed substitute release', async () => {
  const { client, calls } = fakeClient({ amendRow: { ...PENDING_AMEND } });
  const { fn } = fakeTransition([{ ok: false, status: 409, error: 'cannot release substitute' }]);

  const out = await runDecideAmendment({ amendmentId: 55, decision: 'REJECT', actorStaffId: 9 }, client, ORG, { transition: fn });

  assert.deepEqual(out, { ok: false, status: 409, error: 'cannot release substitute' });
  assert.equal(calls.some((c) => c.sql.includes('UPDATE order_unit_amendments')), false);
});

test('decide: idempotent replay when already in the target state', async () => {
  const { client, calls } = fakeClient({ amendRow: { ...PENDING_AMEND, status: 'APPROVED' } });
  const { fn, inputs } = fakeTransition();

  const out = await runDecideAmendment({ amendmentId: 55, decision: 'APPROVE', actorStaffId: 9 }, client, ORG, { transition: fn });

  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.idempotent, true);
  assert.equal(out.status, 'APPROVED');
  assert.equal(inputs.length, 0);
  assert.equal(calls.some((c) => c.sql.includes('UPDATE order_unit_amendments')), false);
});

test('decide: 409 when the amendment is not PENDING', async () => {
  const { client } = fakeClient({ amendRow: { ...PENDING_AMEND, status: 'APPLIED' } });
  const { fn } = fakeTransition();
  const out = await runDecideAmendment({ amendmentId: 55, decision: 'APPROVE', actorStaffId: 9 }, client, ORG, { transition: fn });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.status, 409);
});

test('decide: 404 when the amendment is missing', async () => {
  const { client } = fakeClient({ amendRow: null });
  const { fn } = fakeTransition();
  const out = await runDecideAmendment({ amendmentId: 55, decision: 'APPROVE', actorStaffId: 9 }, client, ORG, { transition: fn });
  assert.deepEqual(out, { ok: false, status: 404, error: 'amendment 55 not found' });
});
