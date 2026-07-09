/**
 * DB-free tests for the entity_signals history read (Phase 5).
 * Run: npx tsx --test src/lib/surfaces/entity-signals-read.test.ts
 */

import '@/lib/assistant/test-db-url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readEntitySignals, getEntitySignal, type EntitySignalsReadDeps } from './entity-signals-read';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '11111111-2222-3333-4444-555555555555' as OrgId;

function fakes(rows: Array<Record<string, unknown>> = []) {
  const cap: { text: string; params: ReadonlyArray<unknown> }[] = [];
  const deps: EntitySignalsReadDeps = {
    query: (async (_orgId: OrgId, text: string, params: ReadonlyArray<unknown>) => {
      cap.push({ text, params });
      return { rows, rowCount: rows.length };
    }) as EntitySignalsReadDeps['query'],
  };
  return { deps, cap };
}

test('readEntitySignals: no filters → org-only WHERE, clamped limit last param', async () => {
  const { deps, cap } = fakes();
  await readEntitySignals(ORG, {}, deps);
  const { text, params } = cap[0];
  assert.ok(text.includes('WHERE organization_id = $1'));
  assert.ok(text.includes('ORDER BY occurred_at DESC, id DESC'));
  assert.deepEqual(params, [ORG, 200]); // org, then default limit
});

test('readEntitySignals: all filters bind in order and use the tsv index', async () => {
  const { deps, cap } = fakes();
  await readEntitySignals(
    ORG,
    { limit: 50, sinceDays: 7, signalKind: 'test_fail_reason', entityType: 'SERIAL_UNIT', q: 'hdmi dead' },
    deps,
  );
  const { text, params } = cap[0];
  assert.ok(text.includes('occurred_at >= NOW() - make_interval(days => $2)'));
  assert.ok(text.includes('signal_kind = $3'));
  assert.ok(text.includes('entity_type = $4'));
  assert.ok(text.includes("notes_tsv @@ websearch_to_tsquery('simple', $5)"));
  assert.deepEqual(params, [ORG, 7, 'test_fail_reason', 'SERIAL_UNIT', 'hdmi dead', 50]);
});

test('readEntitySignals: invalid signalKind/entityType are dropped (registry-validated)', async () => {
  const { deps, cap } = fakes();
  await readEntitySignals(ORG, { signalKind: 'bogus', entityType: 'NOPE', q: '' }, deps);
  const { text, params } = cap[0];
  assert.ok(!text.includes('signal_kind ='));
  assert.ok(!text.includes('entity_type ='));
  assert.ok(!text.includes('notes_tsv')); // empty q dropped
  assert.deepEqual(params, [ORG, 200]);
});

test('readEntitySignals: limit clamps to [1, 500] and entity_id coerces to number', async () => {
  const over = fakes([{ id: 1, occurred_at: 'x', signal_kind: 'buyer_note', entity_type: 'ORDER', entity_id: '77', reason_code: null, notes: null, severity: null }]);
  const rows = await readEntitySignals(ORG, { limit: 100000 }, over.deps);
  assert.equal(over.cap[0].params.at(-1), 500);
  assert.equal(rows[0].entity_id, 77);
  assert.equal(typeof rows[0].entity_id, 'number');
});

test('getEntitySignal: org-scoped by id, coerces entity_id, returns null when absent', async () => {
  const found = fakes([
    { id: 9, occurred_at: 'x', signal_kind: 'test_fail_reason', entity_type: 'SERIAL_UNIT', entity_id: '501', reason_code: 'HDMI', notes: 'n', severity: 2, meta: { verdict: 'TESTING_FAILED' }, source_ref: null, workflow_definition_id: 3, node_id: 'n-x', created_at: 'y' },
  ]);
  const detail = await getEntitySignal(ORG, 9, found.deps);
  assert.equal(detail?.entity_id, 501);
  assert.equal(typeof detail?.entity_id, 'number');
  assert.deepEqual(found.cap[0].params, [ORG, 9]); // org-first, by id
  assert.ok(found.cap[0].text.includes('organization_id = $1 AND id = $2'));

  const absent = fakes([]);
  assert.equal(await getEntitySignal(ORG, 9, absent.deps), null);
});

test('getEntitySignal: invalid id short-circuits to null (no query)', async () => {
  const f = fakes([]);
  assert.equal(await getEntitySignal(ORG, 0, f.deps), null);
  assert.equal(await getEntitySignal(ORG, -5, f.deps), null);
  assert.equal(f.cap.length, 0);
});
