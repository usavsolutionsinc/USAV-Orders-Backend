import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertReceivingLineTesting,
  upsertReceivingLineZoho,
  upsertReceivingLineReturn,
  readReceivingLineZoho,
} from './narrow';
import type { FactsDeps } from './store';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 'org-1' as unknown as OrgId;

function fakes(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ orgId: unknown; sql: string; params: unknown[] }> = [];
  const deps: FactsDeps = {
    query: (async (orgId: unknown, sql: string, params: unknown[]) => {
      calls.push({ orgId, sql, params });
      return { rows };
    }) as unknown as FactsDeps['query'],
  };
  return { deps, calls };
}

test('upsert includes only defined columns + always keys + ON CONFLICT', async () => {
  const { deps, calls } = fakes();
  await upsertReceivingLineTesting(ORG, 7, { needsTest: false }, deps);
  const { sql, params } = calls[0];
  assert.match(sql, /INSERT INTO receiving_line_testing \(receiving_line_id, organization_id, needs_test\)/);
  assert.match(sql, /ON CONFLICT \(receiving_line_id\) DO UPDATE SET needs_test = EXCLUDED\.needs_test, updated_at = now\(\)/);
  assert.deepEqual(params, [7, ORG, false]);
});

test('undefined fields are skipped; null is written (clear)', async () => {
  const skip = fakes();
  await upsertReceivingLineReturn(ORG, 3, { returnReason: 'dent', sourceOrderId: undefined }, skip.deps);
  assert.match(skip.calls[0].sql, /\(receiving_line_id, organization_id, return_reason\)/);
  assert.deepEqual(skip.calls[0].params, [3, ORG, 'dent']);

  const clear = fakes();
  await upsertReceivingLineReturn(ORG, 3, { returnReason: null }, clear.deps);
  assert.deepEqual(clear.calls[0].params, [3, ORG, null]);
});

test('full zoho upsert maps every camelCase field to its column', async () => {
  const { deps, calls } = fakes();
  await upsertReceivingLineZoho(ORG, 9, {
    zohoItemId: 'i1',
    zohoPurchaseOrderId: 'po1',
    unitPrice: '12.50',
  }, deps);
  assert.match(calls[0].sql, /zoho_item_id, zoho_purchaseorder_id, unit_price/);
  assert.deepEqual(calls[0].params, [9, ORG, 'i1', 'po1', '12.50']);
});

test('dispositionAudit jsonb is serialized to a string param', async () => {
  const { deps, calls } = fakes();
  await upsertReceivingLineTesting(ORG, 7, { dispositionAudit: [{ at: 't', code: 'PASS' }] }, deps);
  assert.deepEqual(calls[0].params, [7, ORG, JSON.stringify([{ at: 't', code: 'PASS' }])]);
});

test('reader returns the row or null', async () => {
  const hit = fakes([{ receiving_line_id: 9, zoho_item_id: 'i1' }]);
  assert.deepEqual(await readReceivingLineZoho(ORG, 9, hit.deps), { receiving_line_id: 9, zoho_item_id: 'i1' });
  assert.match(hit.calls[0].sql, /SELECT \* FROM receiving_line_zoho WHERE organization_id = \$1 AND receiving_line_id = \$2/);

  const miss = fakes([]);
  assert.equal(await readReceivingLineZoho(ORG, 9, miss.deps), null);
});
