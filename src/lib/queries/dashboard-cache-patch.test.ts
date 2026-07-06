import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import {
  patchUnshippedOrderCache,
  removeUnshippedOrderFromCache,
  invalidateUnshippedCounts,
} from './dashboard-cache-patch';

const listKey = (extra: Record<string, unknown>) => ['dashboard-table', 'unshipped', extra];

test('patch merges into the matching row across ALL unshipped list variants', () => {
  const qc = new QueryClient();
  qc.setQueryData(listKey({ stage: null }), [{ id: 1, has_tech_scan: false }, { id: 2, has_tech_scan: false }]);
  qc.setQueryData(listKey({ stage: 'pending', limit: 200 }), [{ id: 1, has_tech_scan: false }]);

  patchUnshippedOrderCache(qc, 1, { has_tech_scan: true, tested_by: 7 });

  const a = qc.getQueryData(listKey({ stage: null })) as Array<Record<string, unknown>>;
  const b = qc.getQueryData(listKey({ stage: 'pending', limit: 200 })) as Array<Record<string, unknown>>;
  assert.equal(a[0].has_tech_scan, true, 'variant A row 1 patched');
  assert.equal(a[0].tested_by, 7);
  assert.equal(b[0].has_tech_scan, true, 'variant B row 1 patched');
  assert.equal(a[1].has_tech_scan, false, 'untouched row unchanged');
});

test('patch is a no-op (reference-stable) when the row is not present', () => {
  const qc = new QueryClient();
  const rows = [{ id: 1 }, { id: 2 }];
  qc.setQueryData(listKey({ stage: null }), rows);
  patchUnshippedOrderCache(qc, 999, { has_tech_scan: true });
  assert.equal(qc.getQueryData(listKey({ stage: null })), rows, 'same array reference (no re-render)');
});

test('remove drops the row from every variant', () => {
  const qc = new QueryClient();
  qc.setQueryData(listKey({ stage: null }), [{ id: 1 }, { id: 2 }, { id: 3 }]);
  removeUnshippedOrderFromCache(qc, 2);
  const rows = qc.getQueryData(listKey({ stage: null })) as Array<{ id: number }>;
  assert.deepEqual(rows.map((r) => r.id), [1, 3]);
});

test('list-prefix helpers never touch the separate counts key', () => {
  const qc = new QueryClient();
  const counts = { total: 5, byStage: { all: 5, pending: 5, tested: 0 }, combos: [] };
  qc.setQueryData(['dashboard-table', 'unshipped-counts', { staffId: null }], counts);
  qc.setQueryData(listKey({ stage: null }), [{ id: 1 }]);

  patchUnshippedOrderCache(qc, 1, { has_tech_scan: true });
  removeUnshippedOrderFromCache(qc, 1);

  assert.equal(
    qc.getQueryData(['dashboard-table', 'unshipped-counts', { staffId: null }]),
    counts,
    'counts cache untouched by list-prefix mutations',
  );
});

test('non-array cache entries pass through untouched', () => {
  const qc = new QueryClient();
  qc.setQueryData(listKey({ stage: null }), undefined);
  patchUnshippedOrderCache(qc, 1, { x: 1 });
  removeUnshippedOrderFromCache(qc, 1);
  assert.equal(qc.getQueryData(listKey({ stage: null })), undefined);
});

test('invalidateUnshippedCounts marks the counts query stale', async () => {
  const qc = new QueryClient();
  qc.setQueryData(['dashboard-table', 'unshipped-counts', { staffId: null }], { total: 1 });
  invalidateUnshippedCounts(qc);
  const state = qc.getQueryState(['dashboard-table', 'unshipped-counts', { staffId: null }]);
  assert.equal(state?.isInvalidated, true);
});
