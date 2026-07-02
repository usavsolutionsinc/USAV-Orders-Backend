import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertInboundMirror, getInboundMirror, type MirrorDeps } from './mirror';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

function fakes(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ orgId: unknown; sql: string; params: unknown[] }> = [];
  const deps: MirrorDeps = {
    query: (async (orgId: unknown, sql: string, params: unknown[]) => {
      calls.push({ orgId, sql, params });
      if (/INSERT INTO inbound_purchase_order_mirror/.test(sql)) {
        return { rows: [{ id: 5, source_type: params[1], source_order_id: params[2] }] };
      }
      return { rows };
    }) as unknown as MirrorDeps['query'],
  };
  return { deps, calls };
}

test('upsertInboundMirror upserts on (org, source_type, source_order_id) and serializes json', async () => {
  const { deps, calls } = fakes();
  const row = await upsertInboundMirror(ORG, {
    sourceType: 'ebay',
    sourceOrderId: 'E-1',
    orderNumber: '12-345',
    trackingNumber: '1Z999',
    lineItems: [{ sku: 'X', qty: 1 }],
    rawPayload: { foo: 'bar' },
  }, deps);
  assert.equal(row.id, 5);
  assert.match(calls[0].sql, /ON CONFLICT \(organization_id, source_type, source_order_id\)/);
  // line_items + raw_payload are JSON-stringified into positional params 13 & 14
  assert.equal(calls[0].params[12], JSON.stringify([{ sku: 'X', qty: 1 }]));
  assert.equal(calls[0].params[13], JSON.stringify({ foo: 'bar' }));
});

test('upsertInboundMirror rejects an unregistered source before any SQL', async () => {
  const { deps, calls } = fakes();
  await assert.rejects(() => upsertInboundMirror(ORG, { sourceType: 'etsy', sourceOrderId: 'X' }, deps));
  assert.equal(calls.length, 0);
});

test('getInboundMirror returns the row or null', async () => {
  const hit = fakes([{ id: 5, source_type: 'ebay', source_order_id: 'E-1' }]);
  assert.equal((await getInboundMirror(ORG, 'ebay', 'E-1', hit.deps))?.id, 5);
  assert.deepEqual(hit.calls[0].params, [ORG, 'ebay', 'E-1']);

  const miss = fakes([]);
  assert.equal(await getInboundMirror(ORG, 'ebay', 'nope', miss.deps), null);
});
