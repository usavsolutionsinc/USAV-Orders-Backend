import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStnForOrder } from './resolve-stn-for-order';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '11111111-1111-1111-1111-111111111111' as OrgId;

function fakeClient(script: { shipmentId?: number | null; primaryLink?: number | null }) {
  const queries: { text: string; params: unknown[] }[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ text, params });
      if (text.includes('SELECT shipment_id FROM orders')) {
        return { rows: [{ shipment_id: script.shipmentId ?? null }], rowCount: 1 };
      }
      if (text.includes('FROM shipment_links')) {
        return {
          rows: script.primaryLink != null ? [{ shipment_id: script.primaryLink }] : [],
          rowCount: script.primaryLink != null ? 1 : 0,
        };
      }
      throw new Error(`fakeClient: unhandled query: ${text}`);
    },
  };
  return { client, queries };
}

test('resolveStnForOrder: prefers the orders.shipment_id cache', async () => {
  const { client, queries } = fakeClient({ shipmentId: 101, primaryLink: 202 });

  const result = await resolveStnForOrder(ORG, 1, client);

  assert.equal(result, 101);
  assert.ok(!queries.some((q) => q.text.includes('shipment_links')), 'cache hit — shipment_links must not be queried');
});

test('resolveStnForOrder: falls back to the shipment_links primary row when the cache is null', async () => {
  const { client } = fakeClient({ shipmentId: null, primaryLink: 202 });

  const result = await resolveStnForOrder(ORG, 1, client);

  assert.equal(result, 202);
});

test('resolveStnForOrder: returns null when neither source resolves', async () => {
  const { client } = fakeClient({ shipmentId: null, primaryLink: null });

  const result = await resolveStnForOrder(ORG, 1, client);

  assert.equal(result, null);
});
