import test from 'node:test';
import assert from 'node:assert/strict';
import {
  writeLineFact,
  readLineFact,
  listLineFacts,
  deleteLineFact,
  type FactsDeps,
} from './store';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 'org-1' as unknown as OrgId;

function fakes(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ orgId: unknown; sql: string; params: unknown[] }> = [];
  const deps: FactsDeps = {
    query: (async (orgId: unknown, sql: string, params: unknown[]) => {
      calls.push({ orgId, sql, params });
      if (/INSERT INTO receiving_line_facts/.test(sql)) return { rows: [{ id: 99 }] };
      return { rows };
    }) as unknown as FactsDeps['query'],
  };
  return { deps, calls };
}

test('writeLineFact validates the payload then upserts on (org, line, kind)', async () => {
  const { deps, calls } = fakes();
  const r = await writeLineFact(ORG, 7, 'marketplace_listing', { listingUrl: 'https://x', bogus: 1 }, deps);
  assert.equal(r.id, 99);
  assert.match(calls[0].sql, /INSERT INTO receiving_line_facts/);
  assert.match(calls[0].sql, /ON CONFLICT \(organization_id, receiving_line_id, fact_kind\)/);
  // validated payload had `bogus` stripped before serialization
  assert.deepEqual(calls[0].params, [ORG, 7, 'marketplace_listing', JSON.stringify({ listingUrl: 'https://x' })]);
});

test('writeLineFact rejects a malformed payload before any SQL runs', async () => {
  const { deps, calls } = fakes();
  await assert.rejects(() => writeLineFact(ORG, 7, 'trade_in_valuation', { offeredAmountCents: -5 }, deps));
  assert.equal(calls.length, 0, 'no SQL should run on a validation failure');
});

test('writeLineFact stores an org-custom kind via the passthrough schema', async () => {
  const { deps, calls } = fakes();
  await writeLineFact(ORG, 3, 'consignment_terms', { feePct: 12 }, deps);
  assert.deepEqual(calls[0].params, [ORG, 3, 'consignment_terms', JSON.stringify({ feePct: 12 })]);
});

test('readLineFact returns the payload or null', async () => {
  const hit = fakes([{ payload: { listingUrl: 'https://x' } }]);
  assert.deepEqual(await readLineFact(ORG, 7, 'marketplace_listing', hit.deps), { listingUrl: 'https://x' });
  assert.deepEqual(hit.calls[0].params, [ORG, 7, 'marketplace_listing']);

  const miss = fakes([]);
  assert.equal(await readLineFact(ORG, 7, 'marketplace_listing', miss.deps), null);
});

test('listLineFacts scopes to org+line and orders by kind', async () => {
  const { deps, calls } = fakes([{ id: 1, fact_kind: 'marketplace_listing', payload: {} }]);
  const rows = await listLineFacts(ORG, 7, deps);
  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /ORDER BY fact_kind/);
  assert.deepEqual(calls[0].params, [ORG, 7]);
});

test('deleteLineFact returns the deleted count', async () => {
  const { deps, calls } = fakes([{ id: 5 }]);
  assert.equal(await deleteLineFact(ORG, 7, 'repair_service', deps), 1);
  assert.deepEqual(calls[0].params, [ORG, 7, 'repair_service']);
});
