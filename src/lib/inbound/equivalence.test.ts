import test from 'node:test';
import assert from 'node:assert/strict';
import { recordEquivalence, findEquivalents, type EquivalenceDeps } from './equivalence';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

function fakes(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ orgId: unknown; sql: string; params: unknown[] }> = [];
  const deps: EquivalenceDeps = {
    query: (async (orgId: unknown, sql: string, params: unknown[]) => {
      calls.push({ orgId, sql, params });
      if (/INSERT INTO inbound_purchase_order_equivalence/.test(sql)) {
        return { rows: [{
          id: 1,
          source_type_a: params[1], source_order_id_a: params[2],
          source_type_b: params[3], source_order_id_b: params[4],
          link_reason: params[5],
        }] };
      }
      return { rows };
    }) as unknown as EquivalenceDeps['query'],
  };
  return { deps, calls };
}

test('canonicalizes the pair so ebay sorts before zoho regardless of arg order', async () => {
  const forward = fakes();
  await recordEquivalence(ORG, {
    sourceTypeA: 'ebay', sourceOrderIdA: 'E1',
    sourceTypeB: 'zoho', sourceOrderIdB: 'PO9',
    linkReason: 'tracking',
  }, forward.deps);
  // A side = ebay/E1, B side = zoho/PO9
  assert.deepEqual(forward.calls[0].params.slice(1, 5), ['ebay', 'E1', 'zoho', 'PO9']);

  const reversed = fakes();
  await recordEquivalence(ORG, {
    sourceTypeA: 'zoho', sourceOrderIdA: 'PO9',
    sourceTypeB: 'ebay', sourceOrderIdB: 'E1',
    linkReason: 'order_number',
  }, reversed.deps);
  // same canonical order despite reversed args
  assert.deepEqual(reversed.calls[0].params.slice(1, 5), ['ebay', 'E1', 'zoho', 'PO9']);
  assert.match(reversed.calls[0].sql, /ON CONFLICT[\s\S]*LEAST[\s\S]*GREATEST/);
});

test('rejects self-equivalence and unregistered sources before any SQL', async () => {
  const a = fakes();
  await assert.rejects(
    () => recordEquivalence(ORG, { sourceTypeA: 'ebay', sourceOrderIdA: 'E1', sourceTypeB: 'ebay', sourceOrderIdB: 'E1', linkReason: 'manual' }, a.deps),
    /equivalence of an order with itself/,
  );
  assert.equal(a.calls.length, 0);

  const b = fakes();
  await assert.rejects(
    () => recordEquivalence(ORG, { sourceTypeA: 'ebay', sourceOrderIdA: 'E1', sourceTypeB: 'etsy', sourceOrderIdB: 'X', linkReason: 'manual' }, b.deps),
    /unregistered source_type/,
  );
  assert.equal(b.calls.length, 0);
});

test('findEquivalents unions both sides of the graph', async () => {
  const { deps, calls } = fakes([{ source_type: 'zoho', source_order_id: 'PO9' }]);
  const out = await findEquivalents(ORG, 'ebay', 'E1', deps);
  assert.deepEqual(out, [{ source_type: 'zoho', source_order_id: 'PO9' }]);
  assert.match(calls[0].sql, /UNION/);
  assert.deepEqual(calls[0].params, [ORG, 'ebay', 'E1']);
});
