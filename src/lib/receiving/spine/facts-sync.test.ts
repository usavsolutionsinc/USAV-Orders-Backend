import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLineFacts } from './facts-sync';
import type { FactsDeps } from '../facts/store';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 'org-1' as unknown as OrgId;

function fakes() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const deps: FactsDeps = {
    query: (async (_orgId: unknown, sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [{ id: 1 }] };
    }) as unknown as FactsDeps['query'],
  };
  return { deps, calls };
}

test('syncLineFacts writes only the provided sections', async () => {
  const { deps, calls } = fakes();
  await syncLineFacts(ORG, 7, { testing: { needsTest: true } }, deps);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO receiving_line_testing/);
});

test('syncLineFacts fans out narrow tables + validated registry facts', async () => {
  const { deps, calls } = fakes();
  await syncLineFacts(
    ORG,
    7,
    {
      testing: { needsTest: false },
      returns: { returnReason: 'dent' },
      custom: { repair_service: { isRepairService: true } },
    },
    deps,
  );
  assert.equal(calls.length, 3);
  assert.ok(calls.some((c) => /receiving_line_testing/.test(c.sql)));
  assert.ok(calls.some((c) => /receiving_line_return/.test(c.sql)));
  assert.ok(calls.some((c) => /INSERT INTO receiving_line_facts/.test(c.sql)));
});

test('syncLineFacts rejects a malformed registry fact before writing it', async () => {
  const { deps, calls } = fakes();
  await assert.rejects(() =>
    syncLineFacts(ORG, 7, { custom: { trade_in_valuation: { offeredAmountCents: -1 } } }, deps),
  );
  // the invalid registry write threw inside writeLineFact's validation
  assert.ok(calls.every((c) => !/receiving_line_facts/.test(c.sql)));
});
