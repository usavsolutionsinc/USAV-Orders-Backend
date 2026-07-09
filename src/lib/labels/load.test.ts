import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLabelOverrides, labelKindToFlowContext } from './load';
import { resolveLabel } from './resolve';

function fakeDb(rows: any[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

test('maps flow_context rows into the per-kind overrides bag', async () => {
  const db = fakeDb([
    { flow_context: 'lifecycle_unshipped', code: 'PENDING', label: 'QC Queue', tone: 'indigo' },
    { flow_context: 'lifecycle_outbound', code: 'DELIVERED', label: 'Done', tone: null },
  ]);
  const ov = await loadLabelOverrides('org-1', db);
  assert.deepEqual(ov.unshipped?.PENDING, { label: 'QC Queue', tone: 'indigo' });
  assert.deepEqual(ov.outbound?.DELIVERED, { label: 'Done' }); // null tone omitted
});

test('the loaded overrides actually drive resolveLabel', async () => {
  const db = fakeDb([{ flow_context: 'lifecycle_unshipped', code: 'TESTED', label: 'Passed QC', tone: 'emerald' }]);
  const ov = await loadLabelOverrides('org-1', db);
  const r = resolveLabel('unshipped', 'TESTED', { overrides: ov });
  assert.equal(r.label, 'Passed QC');
  assert.equal(r.dot, 'bg-emerald-500');
  assert.equal(r.source, 'org');
});

test('an invalid tone is rejected (falls back to default tone)', async () => {
  const db = fakeDb([{ flow_context: 'lifecycle_unshipped', code: 'PENDING', label: '', tone: 'neon-pink' }]);
  const ov = await loadLabelOverrides('org-1', db);
  // empty label + invalid tone → nothing to override → code omitted entirely
  assert.equal(ov.unshipped?.PENDING, undefined);
});

test('query error degrades to no overrides (never throws)', async () => {
  const db = { query: async () => { throw new Error('column "tone" does not exist'); } };
  const ov = await loadLabelOverrides('org-1', db as any);
  assert.deepEqual(ov, {});
});

test('scopes the query by org + the lifecycle flow_contexts', async () => {
  const db = fakeDb([]);
  await loadLabelOverrides('org-9', db);
  assert.equal(db.calls[0].params[0], 'org-9');
  assert.deepEqual(db.calls[0].params[1], ['lifecycle_unshipped', 'lifecycle_outbound']);
});

test('labelKindToFlowContext matches the migration CHECK names', () => {
  assert.equal(labelKindToFlowContext('unshipped'), 'lifecycle_unshipped');
  assert.equal(labelKindToFlowContext('outbound'), 'lifecycle_outbound');
});
