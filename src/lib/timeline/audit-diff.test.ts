import test from 'node:test';
import assert from 'node:assert/strict';
import { diffChanges } from './audit-diff';

test('diffChanges: both snapshots present → changed keys only', () => {
  const changes = diffChanges(
    { status: 'open', qty: 1, note: 'same' },
    { status: 'closed', qty: 2, note: 'same' },
  );
  assert.deepEqual(changes, [
    { key: 'status', before: 'open', after: 'closed' },
    { key: 'qty', before: '1', after: '2' },
  ]);
});

test('diffChanges: one-sided payload yields NO changes (the gating contract)', () => {
  // Missing `before` (creation, OR a redacted non-admin request) → nothing.
  assert.deepEqual(diffChanges(null, { status: 'closed' }), []);
  assert.deepEqual(diffChanges(undefined, { status: 'closed' }), []);
  // Missing `after` (deletion) → nothing.
  assert.deepEqual(diffChanges({ status: 'open' }, null), []);
});

test('diffChanges: added/removed keys within a real edit render with — sentinel side', () => {
  const changes = diffChanges({ a: 1 }, { a: 1, b: 2 });
  assert.deepEqual(changes, [{ key: 'b', before: null, after: '2' }]);
});

test('diffChanges: objects stringify; equal values skipped', () => {
  const changes = diffChanges(
    { meta: { x: 1 }, same: 'v' },
    { meta: { x: 2 }, same: 'v' },
  );
  assert.deepEqual(changes, [{ key: 'meta', before: '{"x":1}', after: '{"x":2}' }]);
});

test('diffChanges: caps the number of rows', () => {
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  for (let i = 0; i < 50; i++) {
    before[`k${i}`] = i;
    after[`k${i}`] = i + 1;
  }
  assert.equal(diffChanges(before, after, 12).length, 12);
});
