import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateKitReadiness } from './kit-readiness';

test('empty BOM never blocks (graceful degradation)', () => {
  const r = evaluateKitReadiness([], [], 'block_until_matched');
  assert.equal(r.requiredTotal, 0);
  assert.equal(r.allRequiredIn, true);
  assert.equal(r.blocked, false);
});

test('non-critical parts are not "required" and never block', () => {
  const r = evaluateKitReadiness(
    [{ id: 1, critical: false }, { id: 2, critical: false }],
    [],
    'block_until_matched',
  );
  assert.equal(r.requiredTotal, 0);
  assert.equal(r.allRequiredIn, true);
  assert.equal(r.blocked, false);
});

test('block_until_matched blocks while a critical part is unconfirmed', () => {
  const parts = [{ id: 1, critical: true }, { id: 2, critical: true }];
  const r = evaluateKitReadiness(parts, [1], 'block_until_matched');
  assert.equal(r.requiredTotal, 2);
  assert.equal(r.requiredConfirmed, 1);
  assert.deepEqual(r.missingRequiredIds, [2]);
  assert.equal(r.allRequiredIn, false);
  assert.equal(r.blocked, true);
});

test('block_until_matched clears once every critical part is confirmed', () => {
  const parts = [{ id: 1, critical: true }, { id: 2, critical: true }];
  const r = evaluateKitReadiness(parts, [1, 2], 'block_until_matched');
  assert.equal(r.allRequiredIn, true);
  assert.equal(r.missingRequiredIds.length, 0);
  assert.equal(r.blocked, false);
});

test('advisory never blocks, even with critical parts missing', () => {
  const parts = [{ id: 1, critical: true }];
  const r = evaluateKitReadiness(parts, [], 'advisory');
  assert.equal(r.allRequiredIn, false);
  assert.equal(r.requiredConfirmed, 0);
  assert.equal(r.blocked, false);
});

test('accepts a Set of confirmed ids as well as an array', () => {
  const parts = [{ id: 7, critical: true }];
  const r = evaluateKitReadiness(parts, new Set([7]), 'block_until_matched');
  assert.equal(r.allRequiredIn, true);
  assert.equal(r.blocked, false);
});
