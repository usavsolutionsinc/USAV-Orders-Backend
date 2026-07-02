import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestPurchase, type IngestPurchaseDeps } from './ingest-purchase';
import type { TxClient } from './purchase-links';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

function fakes(opts: { existingLineId?: number | null; accountId?: number | null } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const linkCalls: Array<Record<string, unknown>> = [];
  const mirrorCalls: Array<Record<string, unknown>> = [];

  const client: TxClient = {
    query: (async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [], rowCount: 1 };
      if (/FROM platform_accounts/.test(sql)) {
        return { rows: opts.accountId != null ? [{ id: opts.accountId }] : [], rowCount: opts.accountId != null ? 1 : 0 };
      }
      if (/FROM inbound_purchase_order_links/.test(sql)) {
        return { rows: opts.existingLineId != null ? [{ receiving_line_id: opts.existingLineId }] : [], rowCount: opts.existingLineId != null ? 1 : 0 };
      }
      if (/INSERT INTO receiving_lines/.test(sql)) return { rows: [{ id: 100 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) as TxClient['query'],
  };

  const deps: IngestPurchaseDeps = {
    withTx: (async (_o: unknown, fn: (c: TxClient) => Promise<unknown>) => fn(client)) as IngestPurchaseDeps['withTx'],
    upsertPurchaseLink: (async (_o: unknown, input: Record<string, unknown>) => {
      linkCalls.push(input);
      return { id: 1, receiving_line_id: input.receivingLineId, source_type: input.sourceType, source_order_id: input.sourceOrderId, source_line_item_id: input.sourceLineItemId ?? null, is_primary: input.isPrimary, platform_account_id: input.platformAccountId ?? null };
    }) as unknown as IngestPurchaseDeps['upsertPurchaseLink'],
    upsertInboundMirror: (async (_o: unknown, input: Record<string, unknown>) => {
      mirrorCalls.push(input);
      return { id: 5, source_type: input.sourceType, source_order_id: input.sourceOrderId, platform_account_id: input.platformAccountId ?? null, order_number: null, vendor_or_seller_name: null, status: null, payment_status: null, tracking_number: null, carrier_code: null };
    }) as unknown as IngestPurchaseDeps['upsertInboundMirror'],
  };
  return { deps, calls, linkCalls, mirrorCalls };
}

test('new order: locks, resolves account, upserts mirror, inserts spine, primary link + facts', async () => {
  const { deps, calls, linkCalls, mirrorCalls } = fakes({ existingLineId: null, accountId: 7 });
  const r = await ingestPurchase(ORG, {
    sourceOrderId: 'E-123',
    accountLabel: 'USAV-Buyer',
    sku: 'SKU-1',
    itemName: 'Sony WH-1000XM5',
    quantityExpected: 2,
    sellerUsername: 'acme_deals',
  }, deps);

  assert.equal(r.created, true);
  assert.equal(r.receivingLineId, 100);
  assert.equal(r.platformAccountId, 7);

  const sqls = calls.map((c) => c.sql);
  assert.ok(sqls.some((s) => /pg_advisory_xact_lock/.test(s)), 'takes the advisory lock');
  assert.ok(sqls.some((s) => /FROM platform_accounts/.test(s)), 'resolves the buyer account');
  assert.ok(sqls.some((s) => /INSERT INTO receiving_lines/.test(s)), 'creates the spine row');

  // mirror stamped with the resolved account
  assert.equal(mirrorCalls[0].platformAccountId, 7);
  // primary link with facts, stamped with the buyer account (the Incoming chip)
  assert.equal(linkCalls[0].isPrimary, true);
  assert.equal(linkCalls[0].platformAccountId, 7);
  assert.equal(linkCalls[0].receivingLineId, 100);
  assert.deepEqual(linkCalls[0].facts, { kind: 'ebay_purchase', payload: { sellerUsername: 'acme_deals' } });
});

test('existing order: reuses the spine row, no INSERT', async () => {
  const { deps, calls, linkCalls } = fakes({ existingLineId: 55, accountId: 7 });
  const r = await ingestPurchase(ORG, { sourceOrderId: 'E-123', sku: 'SKU-1' }, deps);
  assert.equal(r.created, false);
  assert.equal(r.receivingLineId, 55);
  assert.ok(!calls.some((c) => /INSERT INTO receiving_lines/.test(c.sql)), 'must not create a second spine row');
  assert.equal(linkCalls[0].receivingLineId, 55);
});

test('no account label → null platform account, no account SELECT', async () => {
  const { deps, calls, linkCalls } = fakes({ existingLineId: null, accountId: null });
  const r = await ingestPurchase(ORG, { sourceOrderId: 'E-9', itemName: 'thing' }, deps);
  assert.equal(r.platformAccountId, null);
  assert.ok(!calls.some((c) => /FROM platform_accounts/.test(c.sql)), 'no account lookup without a label');
  assert.equal(linkCalls[0].platformAccountId, null);
});

test('rejects a blank order id and an unregistered source before any tx', async () => {
  const a = fakes();
  await assert.rejects(() => ingestPurchase(ORG, { sourceOrderId: '   ', sku: 'X' }, a.deps), /sourceOrderId is required/);
  assert.equal(a.calls.length, 0);

  const b = fakes();
  await assert.rejects(() => ingestPurchase(ORG, { sourceType: 'etsy', sourceOrderId: 'E-1', sku: 'X' }, b.deps), /unregistered source_type/);
  assert.equal(b.calls.length, 0);
});
