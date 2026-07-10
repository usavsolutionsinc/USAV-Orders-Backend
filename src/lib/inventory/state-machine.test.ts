import test from 'node:test';
import assert from 'node:assert/strict';
import { guard, allowedFrom } from './state-machine';

// Phase 1.1 widened the allow-list so recordTestVerdict's real test-bench
// transitions flow through the guard instead of a raw UPDATE. These pin the
// new edges + prove the additions didn't loosen identity / illegal moves.

test('guard: IN_TEST → TESTED is allowed (recordTestVerdict PASS happy path)', () => {
  assert.equal(guard('IN_TEST', 'TESTED').ok, true);
});

test('guard: REPAIR_DONE → TESTED is allowed (PASS straight off a repair)', () => {
  assert.equal(guard('REPAIR_DONE', 'TESTED').ok, true);
});

test('guard: TESTED → IN_TEST is allowed (TEST_AGAIN re-test of a passed unit)', () => {
  assert.equal(guard('TESTED', 'IN_TEST').ok, true);
});

test('guard: GRADED → TESTED is allowed (PASS on an already-graded unit)', () => {
  assert.equal(guard('GRADED', 'TESTED').ok, true);
});

test('guard: pre-existing edges still hold (RECEIVED→TESTED, GRADED→IN_TEST)', () => {
  assert.equal(guard('RECEIVED', 'TESTED').ok, true);
  assert.equal(guard('RECEIVED', 'IN_TEST').ok, true);
  assert.equal(guard('GRADED', 'IN_TEST').ok, true);
});

test('guard: an identity transition is rejected', () => {
  const r = guard('TESTED', 'TESTED');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /identity/);
});

test('guard: any state can enter ON_HOLD (universal hold entry, incl. TESTING_FAILED)', () => {
  assert.equal(guard('IN_TEST', 'ON_HOLD').ok, true);
  assert.equal(guard('TESTED', 'ON_HOLD').ok, true);
  assert.equal(guard('SHIPPED', 'ON_HOLD').ok, true);
});

test('guard: ON_HOLD exits to the restorable set (release-from-hold, Phase 1.3)', () => {
  // releaseUnit restores the pre-hold state; every restorable destination must
  // be guard-legal so the guarded release never rejects.
  for (const to of ['STOCKED', 'TRIAGED', 'IN_REPAIR', 'REPAIR_DONE', 'IN_TEST',
                     'GRADED', 'ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED'] as const) {
    assert.equal(guard('ON_HOLD', to).ok, true, `ON_HOLD → ${to} must be allowed`);
  }
  // ON_HOLD → ON_HOLD is still an identity no-op (rejected).
  assert.equal(guard('ON_HOLD', 'ON_HOLD').ok, false);
  // A non-restorable destination stays closed.
  assert.equal(guard('ON_HOLD', 'SHIPPED').ok, false);
});

test('guard: order-release rewind edges (outbound → STOCKED, Phase 1.3)', () => {
  // Cancelling an order before ship returns each allocated/picked/packed unit
  // to stock — every outbound state must reach STOCKED.
  for (const from of ['ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED'] as const) {
    assert.equal(guard(from, 'STOCKED').ok, true, `${from} → STOCKED must be allowed`);
  }
});

test('guard: FBA direct-ship edges (sellable → SHIPPED, Phase 1.3)', () => {
  // FBA ships sellable units straight to Amazon from stock/graded/tested
  // (link-unit normally allocates first; ALLOCATED/PICKED→SHIPPED already exist).
  for (const from of ['ALLOCATED', 'STOCKED', 'GRADED', 'TESTED'] as const) {
    assert.equal(guard(from, 'SHIPPED').ok, true, `${from} → SHIPPED must be allowed`);
  }
  // A non-sellable/broken source must NOT ship (was a latent force-ship bug).
  assert.equal(guard('IN_REPAIR', 'SHIPPED').ok, false);
  assert.equal(guard('SCRAPPED', 'SHIPPED').ok, false);
});

test('guard: RETURNED → SHIPPED is allowed (returns-intake undo restores the pre-return state)', () => {
  // /api/returns/undo restores the status recorded on the RETURNED event's
  // prev_status — typically SHIPPED. STOCKED/RMA back-edges pre-existed.
  assert.equal(guard('RETURNED', 'SHIPPED').ok, true);
  assert.equal(guard('RETURNED', 'STOCKED').ok, true);
  assert.equal(guard('RETURNED', 'RMA').ok, true);
});

test('guard: force-pick override edges (STOCKED/TESTED/GRADED → PICKED, pick/scan override_mismatch)', () => {
  // /api/pick/scan with override_mismatch=true force-picks a sellable unit
  // that has no open ALLOCATED row. Only sellable sources are modeled.
  for (const from of ['STOCKED', 'TESTED', 'GRADED'] as const) {
    assert.equal(guard(from, 'PICKED').ok, true, `${from} → PICKED must be allowed`);
  }
  // Non-sellable / already-outbound sources must NOT force-pick.
  assert.equal(guard('SHIPPED', 'PICKED').ok, false);
  assert.equal(guard('IN_REPAIR', 'PICKED').ok, false);
  assert.equal(guard('SCRAPPED', 'PICKED').ok, false);
  assert.equal(guard('RECEIVED', 'PICKED').ok, false);
});

test('guard: a genuinely illegal transition is still rejected', () => {
  // Widening added IN_TEST/REPAIR_DONE/TESTED edges only — unrelated jumps stay closed.
  assert.equal(guard('SHIPPED', 'TESTED').ok, false);
  assert.equal(guard('SCRAPPED', 'TESTED').ok, false); // SCRAPPED is terminal
});

test('allowedFrom: IN_TEST now reaches TESTED and always ON_HOLD', () => {
  const from = allowedFrom('IN_TEST');
  assert.ok(from.includes('TESTED'), 'IN_TEST → TESTED added');
  assert.ok(from.includes('ON_HOLD'), 'ON_HOLD is always reachable');
});
