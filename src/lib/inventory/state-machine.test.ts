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
