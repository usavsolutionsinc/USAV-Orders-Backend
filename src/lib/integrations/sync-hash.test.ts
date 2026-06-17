/**
 * Run: npx tsx --test src/lib/integrations/sync-hash.test.ts
 * (wired as `npm run test:sync-hash`)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSyncHash, stableStringify, evaluateSync } from './sync-hash';

test('key order does not change the hash', () => {
  const a = computeSyncHash({ sku: 'X', price: 100, qty: 2 });
  const b = computeSyncHash({ qty: 2, price: 100, sku: 'X' });
  assert.equal(a, b);
});

test('nested key order does not change the hash', () => {
  const a = computeSyncHash({ meta: { b: 1, a: 2 }, list: [{ y: 1, x: 2 }] });
  const b = computeSyncHash({ list: [{ x: 2, y: 1 }], meta: { a: 2, b: 1 } });
  assert.equal(a, b);
});

test('array order IS significant', () => {
  assert.notEqual(computeSyncHash([1, 2, 3]), computeSyncHash([3, 2, 1]));
});

test('undefined is treated as absent', () => {
  assert.equal(computeSyncHash({ a: 1, b: undefined }), computeSyncHash({ a: 1 }));
});

test('a real value change changes the hash', () => {
  assert.notEqual(computeSyncHash({ price: 100 }), computeSyncHash({ price: 101 }));
});

test('stableStringify sorts keys', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('evaluateSync: never-synced is not unchanged', () => {
  const { unchanged } = evaluateSync({ a: 1 }, null);
  assert.equal(unchanged, false);
});

test('evaluateSync: matching previous hash is unchanged (skip)', () => {
  const payload = { a: 1, b: 2 };
  const first = computeSyncHash(payload);
  const { hash, unchanged } = evaluateSync(payload, first);
  assert.equal(hash, first);
  assert.equal(unchanged, true);
});

test('evaluateSync: changed payload is not unchanged', () => {
  const prev = computeSyncHash({ a: 1 });
  const { unchanged } = evaluateSync({ a: 2 }, prev);
  assert.equal(unchanged, false);
});
