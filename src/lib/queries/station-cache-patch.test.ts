import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import {
  invalidateTechCounts,
  patchPackerLogCache,
  patchTechLogCache,
  prependPackerLogCache,
  prependTechLogCache,
  removeReceivingLineFromCache,
  removeTechLogFromCache,
} from './station-cache-patch';

const TECH_KEY = ['tech-logs', 7, { weekStart: '2026-06-30', weekEnd: '2026-07-06' }];
const TECH_KEY_2 = ['tech-logs', 7, { weekStart: '2026-06-23', weekEnd: '2026-06-29' }];
const PACKER_KEY = ['packer-logs', 9, { weekStart: '2026-06-30', weekEnd: '2026-07-06' }];
const RECV_KEY = ['receiving-lines', { mode: 'history' }];

test('patchTechLogCache merges into the matching row across every cached variant', () => {
  const qc = new QueryClient();
  qc.setQueryData(TECH_KEY, [{ id: 1, condition: 'USED' }, { id: 2, condition: 'NEW' }]);
  qc.setQueryData(TECH_KEY_2, [{ id: 1, condition: 'USED' }]);

  patchTechLogCache(qc, 1, { condition: 'FOR_PARTS' });

  assert.equal((qc.getQueryData(TECH_KEY) as any[])[0].condition, 'FOR_PARTS');
  assert.equal((qc.getQueryData(TECH_KEY) as any[])[1].condition, 'NEW'); // untouched
  assert.equal((qc.getQueryData(TECH_KEY_2) as any[])[0].condition, 'FOR_PARTS'); // second variant too
});

test('patchTechLogCache is a no-op (reference-stable) when the id is absent', () => {
  const qc = new QueryClient();
  const rows = [{ id: 1 }, { id: 2 }];
  qc.setQueryData(TECH_KEY, rows);
  patchTechLogCache(qc, 999, { condition: 'X' });
  assert.equal(qc.getQueryData(TECH_KEY), rows); // same reference → no re-render
});

test('removeTechLogFromCache drops the row; missing id leaves the array by reference', () => {
  const qc = new QueryClient();
  const rows = [{ id: 1 }, { id: 2 }];
  qc.setQueryData(TECH_KEY, rows);
  removeTechLogFromCache(qc, 2);
  assert.deepEqual(qc.getQueryData(TECH_KEY), [{ id: 1 }]);
  const after = qc.getQueryData(TECH_KEY);
  removeTechLogFromCache(qc, 12345);
  assert.equal(qc.getQueryData(TECH_KEY), after); // unchanged reference
});

test('prependTechLogCache inserts at the head and de-dupes by id', () => {
  const qc = new QueryClient();
  qc.setQueryData(TECH_KEY, [{ id: 1 }, { id: 2 }]);
  prependTechLogCache(qc, { id: 3, serial_number: 'SN-3' });
  assert.deepEqual((qc.getQueryData(TECH_KEY) as any[]).map((r) => r.id), [3, 1, 2]);
  // Racing a refetch that already has id 3 → no double insert.
  prependTechLogCache(qc, { id: 3, serial_number: 'SN-3' });
  assert.deepEqual((qc.getQueryData(TECH_KEY) as any[]).map((r) => r.id), [3, 1, 2]);
});

test('packer helpers operate over the packer prefix only', () => {
  const qc = new QueryClient();
  qc.setQueryData(PACKER_KEY, [{ id: 5, condition: 'USED' }]);
  qc.setQueryData(TECH_KEY, [{ id: 5, condition: 'USED' }]);
  patchPackerLogCache(qc, 5, { condition: 'NEW' });
  assert.equal((qc.getQueryData(PACKER_KEY) as any[])[0].condition, 'NEW');
  assert.equal((qc.getQueryData(TECH_KEY) as any[])[0].condition, 'USED'); // tech prefix untouched
  prependPackerLogCache(qc, { id: 6 });
  assert.deepEqual((qc.getQueryData(PACKER_KEY) as any[]).map((r) => r.id), [6, 5]);
});

test('receiving remove + counts invalidate touch only their own keys', () => {
  const qc = new QueryClient();
  qc.setQueryData(RECV_KEY, [{ id: 10 }, { id: 11 }]);
  removeReceivingLineFromCache(qc, 10);
  assert.deepEqual((qc.getQueryData(RECV_KEY) as any[]).map((r) => r.id), [11]);
  // A non-array placeholder passes through untouched.
  qc.setQueryData(['tech-logs', 7, 'warmup'], { pending: true });
  patchTechLogCache(qc, 1, { x: 1 });
  assert.deepEqual(qc.getQueryData(['tech-logs', 7, 'warmup']), { pending: true });
  // Counts invalidate doesn't throw with no counts query mounted.
  invalidateTechCounts(qc);
});
