import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertPurchaseLink,
  listPurchaseLinksForLine,
  findLineIdsBySource,
  type PurchaseLinksDeps,
  type TxClient,
} from './purchase-links';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

function fakes(opts: { parentExists?: boolean } = {}) {
  const parentExists = opts.parentExists ?? true;
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client: TxClient = {
    query: (async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT id FROM receiving_lines/.test(sql)) {
        return { rows: parentExists ? [{ id: params[0] }] : [], rowCount: parentExists ? 1 : 0 };
      }
      if (/INSERT INTO inbound_purchase_order_links/.test(sql)) {
        return {
          rows: [{
            id: 1,
            receiving_line_id: params[1],
            source_type: params[2],
            source_order_id: params[3],
            source_line_item_id: params[4],
            is_primary: params[5],
            platform_account_id: params[6],
          }],
          rowCount: 1,
        };
      }
      if (/SELECT DISTINCT receiving_line_id/.test(sql)) {
        return { rows: [{ receiving_line_id: 10 }, { receiving_line_id: 11 }], rowCount: 2 };
      }
      if (/SELECT id, receiving_line_id/.test(sql)) {
        return { rows: [{ id: 1, receiving_line_id: 7, source_type: 'ebay', source_order_id: 'E1', source_line_item_id: null, is_primary: true, platform_account_id: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }) as TxClient['query'],
  };
  const deps: PurchaseLinksDeps = {
    withTx: (async (_orgId: unknown, fn: (c: TxClient) => Promise<unknown>) => fn(client)) as PurchaseLinksDeps['withTx'],
  };
  return { deps, calls };
}

test('primary upsert: validates parent, demotes, upserts, dual-writes cache + facts in order', async () => {
  const { deps, calls } = fakes();
  const row = await upsertPurchaseLink(
    ORG,
    {
      receivingLineId: 7,
      sourceType: 'ebay',
      sourceOrderId: 'E-1',
      sourceLineItemId: null,
      isPrimary: true,
      platformAccountId: 42,
      facts: { kind: 'ebay_purchase', payload: { sellerUsername: 'acme', bogus: 'x' } },
    },
    deps,
  );
  assert.equal(row.id, 1);
  assert.equal(row.source_type, 'ebay');

  const sqls = calls.map((c) => c.sql);
  assert.match(sqls[0], /SELECT id FROM receiving_lines/);
  assert.match(sqls[1], /UPDATE inbound_purchase_order_links\s+SET is_primary = false/);
  assert.match(sqls[2], /INSERT INTO inbound_purchase_order_links/);
  assert.match(sqls[2], /ON CONFLICT/);
  assert.match(sqls[3], /UPDATE receiving_lines/);
  assert.match(sqls[4], /INSERT INTO receiving_line_facts/);
  // facts payload validated → bogus stripped before serialization
  assert.deepEqual(calls[4].params, [ORG, 7, 'ebay_purchase', JSON.stringify({ sellerUsername: 'acme' })]);
  assert.equal(calls.length, 5);
});

test('non-primary upsert: no demote, no spine cache, no facts', async () => {
  const { deps, calls } = fakes();
  await upsertPurchaseLink(
    ORG,
    { receivingLineId: 7, sourceType: 'zoho', sourceOrderId: 'PO-1', sourceLineItemId: 'L1', isPrimary: false },
    deps,
  );
  const sqls = calls.map((c) => c.sql);
  assert.match(sqls[0], /SELECT id FROM receiving_lines/);
  assert.match(sqls[1], /INSERT INTO inbound_purchase_order_links/);
  assert.equal(calls.length, 2, 'only parent-check + link insert should run');
  assert.ok(!sqls.some((s) => /UPDATE receiving_lines/.test(s)));
});

test('rejects an unregistered source before any SQL', async () => {
  const { deps, calls } = fakes();
  await assert.rejects(
    () => upsertPurchaseLink(ORG, { receivingLineId: 7, sourceType: 'etsy', sourceOrderId: 'X' }, deps),
    /unregistered source_type/,
  );
  assert.equal(calls.length, 0);
});

test('rejects a malformed facts payload before any SQL', async () => {
  const { deps, calls } = fakes();
  await assert.rejects(
    () => upsertPurchaseLink(
      ORG,
      { receivingLineId: 7, sourceType: 'ebay', sourceOrderId: 'E1', facts: { kind: 'ebay_purchase', payload: { sellerUsername: 123 } } },
      deps,
    ),
  );
  assert.equal(calls.length, 0);
});

test('throws when the parent line does not exist for the org (link insert never runs)', async () => {
  const { deps, calls } = fakes({ parentExists: false });
  await assert.rejects(
    () => upsertPurchaseLink(ORG, { receivingLineId: 999, sourceType: 'ebay', sourceOrderId: 'E1', isPrimary: true }, deps),
    /receiving_line 999 not found/,
  );
  assert.equal(calls.length, 1, 'only the parent-existence SELECT should have run');
  assert.match(calls[0].sql, /SELECT id FROM receiving_lines/);
});

test('findLineIdsBySource returns the distinct line ids', async () => {
  const { deps, calls } = fakes();
  const ids = await findLineIdsBySource(ORG, 'zoho', 'PO-1', deps);
  assert.deepEqual(ids, [10, 11]);
  assert.deepEqual(calls[0].params, [ORG, 'zoho', 'PO-1']);
});

test('listPurchaseLinksForLine orders primary first', async () => {
  const { deps, calls } = fakes();
  const rows = await listPurchaseLinksForLine(ORG, 7, deps);
  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /ORDER BY is_primary DESC/);
});
