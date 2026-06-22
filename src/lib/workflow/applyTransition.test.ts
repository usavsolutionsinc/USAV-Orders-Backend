import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTransition, type ApplyTransitionDeps } from './applyTransition';
import type { TransitionInput, TransitionResult } from '@/lib/inventory/state-machine';
import type { RecordInventoryEventInput } from '@/lib/inventory/events';
import type { WorkflowTapArgs } from './tap';

const ORG = 'org-1';

interface Captured {
  transitionInputs: TransitionInput[];
  transitionOrgs: Array<string | undefined>;
  events: RecordInventoryEventInput[];
  taps: WorkflowTapArgs[];
}

/** Build injectable fakes; `transitionResult` is what the guarded writer returns. */
function fakes(transitionResult: TransitionResult, eventId = 500) {
  const cap: Captured = { transitionInputs: [], transitionOrgs: [], events: [], taps: [] };
  const deps: ApplyTransitionDeps = {
    transition: (async (input: TransitionInput, _db: unknown, orgId?: string) => {
      cap.transitionInputs.push(input);
      cap.transitionOrgs.push(orgId);
      return transitionResult;
    }) as ApplyTransitionDeps['transition'],
    recordEvent: async (input) => {
      cap.events.push(input);
      return { id: eventId };
    },
    tap: async (args) => {
      cap.taps.push(args);
    },
  };
  return { deps, cap };
}

const baseArgs = {
  unitId: 42,
  to: 'TESTED' as const,
  eventType: 'TEST_PASS' as const,
  tapEvent: 'test_verdict' as const,
  tapInput: { verdict: 'PASS' },
  actorStaffId: 7,
  station: 'TECH' as const,
  clientEventId: 'evt-1',
  notes: 'looks good',
  payload: { verdict: 'PASS' },
  receivingLineId: 9,
  binId: null,
  sku: 'SKU-1',
  orgId: ORG,
  source: 'manual' as const,
};

test('applyTransition: happy path writes via transition() then taps, no idempotent event', async () => {
  const { deps, cap } = fakes({ ok: true, eventId: 99, from: 'IN_TEST', to: 'TESTED' });
  const out = await applyTransition(baseArgs, deps);

  assert.deepEqual(out, { ok: true, status: 200, from: 'IN_TEST', to: 'TESTED', eventId: 99, idempotent: false });
  assert.equal(cap.transitionInputs.length, 1);
  assert.equal(cap.events.length, 0, 'no separate idempotent event on the happy path');
  assert.equal(cap.taps.length, 1);

  // threading into transition()
  const ti = cap.transitionInputs[0];
  assert.equal(ti.unitId, 42);
  assert.equal(ti.to, 'TESTED');
  assert.equal(ti.eventType, 'TEST_PASS');
  assert.equal(ti.receivingLineId, 9);
  assert.equal(ti.binId, null);
  assert.equal(ti.clientEventId, 'evt-1');
  assert.equal(cap.transitionOrgs[0], ORG);

  // threading into the tap
  assert.deepEqual(cap.taps[0], {
    serialUnitId: 42,
    event: 'test_verdict',
    input: { verdict: 'PASS' },
    staffId: 7,
    source: 'manual',
    orgId: ORG,
  });
});

test('applyTransition: identity (already at target) records the event + taps, idempotent:true', async () => {
  // transition() classifies from===to as a 409 'identity transition' before the
  // allow-list check, so from===to uniquely signals an idempotent re-entry.
  const { deps, cap } = fakes(
    { ok: false, status: 409, from: 'TESTED', error: 'identity transition' },
    777,
  );
  const out = await applyTransition(baseArgs, deps);

  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.idempotent, true);
    assert.equal(out.eventId, 777);
    assert.equal(out.from, 'TESTED');
    assert.equal(out.to, 'TESTED');
  }
  assert.equal(cap.events.length, 1, 'idempotent re-entry still leaves an event trail');
  assert.equal(cap.events[0].serial_unit_id, 42);
  assert.equal(cap.events[0].prev_status, 'TESTED');
  assert.equal(cap.events[0].next_status, 'TESTED');
  assert.equal(cap.events[0].sku, 'SKU-1');
  assert.equal(cap.taps.length, 1, 'still taps the engine on re-entry');
});

test('applyTransition: a genuine guard rejection does NOT tap and surfaces 409', async () => {
  const { deps, cap } = fakes({
    ok: false,
    status: 409,
    from: 'SHIPPED',
    error: 'transition SHIPPED → TESTED not allowed',
  });
  const out = await applyTransition(baseArgs, deps);

  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.status, 409);
    assert.equal(out.from, 'SHIPPED');
    assert.match(out.error, /not allowed/);
  }
  assert.equal(cap.events.length, 0);
  assert.equal(cap.taps.length, 0, 'no engine tap when the domain state did not change');
});

test('applyTransition: with expectedFrom, a 409 (even from===to) is a rejection, not idempotent', async () => {
  // transition() runs the expectedFrom drift check BEFORE the guard identity
  // check, so a caller using optimistic concurrency wants any 409 to fail —
  // even the edge where the drifted state happens to equal the target.
  const { deps, cap } = fakes({
    ok: false,
    status: 409,
    from: 'TESTED',
    error: 'expected from=IN_TEST but unit is in TESTED',
  });
  const out = await applyTransition({ ...baseArgs, expectedFrom: 'IN_TEST' }, deps);

  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.status, 409);
  assert.equal(cap.events.length, 0, 'must NOT record an idempotent event on a drift rejection');
  assert.equal(cap.taps.length, 0, 'must NOT tap on a drift rejection');
});

test('applyTransition: a missing unit surfaces 404 and does not tap', async () => {
  const { deps, cap } = fakes({ ok: false, status: 404, error: 'serial_unit 42 not found' });
  const out = await applyTransition(baseArgs, deps);

  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.status, 404);
  assert.equal(cap.taps.length, 0);
  assert.equal(cap.events.length, 0);
});
