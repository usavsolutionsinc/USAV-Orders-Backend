import test from 'node:test';
import assert from 'node:assert/strict';
import { syncEbayPurchasesToReceiving, type SyncEbayPurchasesDeps } from './sync-ebay-purchases';
import type { BuyerAccountRef, BuyerPurchaseLine } from '@/lib/ebay/purchase-client';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

function fakes(opts: {
  accounts?: BuyerAccountRef[];
  linesByAccount?: Record<string, BuyerPurchaseLine[]>;
  fetchThrowsFor?: string;
  ingestThrowsFor?: string;
} = {}) {
  const ingested: Array<Record<string, unknown>> = [];
  const cursorsSet: string[] = [];
  const deps: SyncEbayPurchasesDeps = {
    listBuyerAccounts: async () => opts.accounts ?? [],
    fetchPurchases: async (_o, account) => {
      if (opts.fetchThrowsFor === account.accountName) throw new Error('boom');
      return opts.linesByAccount?.[account.accountName] ?? [];
    },
    ingest: (async (_o: unknown, input: Record<string, unknown>) => {
      if (opts.ingestThrowsFor === input.sourceOrderId) throw new Error('ingest failed');
      ingested.push(input);
      return { receivingLineId: 100 + ingested.length, created: true, platformAccountId: 7, sourceType: 'ebay', sourceOrderId: input.sourceOrderId };
    }) as unknown as SyncEbayPurchasesDeps['ingest'],
    getCursor: async () => null,
    setCursor: async (resource: string) => { cursorsSet.push(resource); },
    now: () => 1_700_000_000_000,
  };
  return { deps, ingested, cursorsSet };
}

test('no buyer accounts → zero result', async () => {
  const { deps } = fakes({ accounts: [] });
  const r = await syncEbayPurchasesToReceiving(ORG, deps);
  assert.deepEqual(r, { orgId: ORG, accounts: 0, linesFetched: 0, ingested: 0, created: 0, errors: [] });
});

test('ingests each fetched line with the buyer account label + advances the cursor', async () => {
  const { deps, ingested, cursorsSet } = fakes({
    accounts: [{ accountName: 'USAV-Buyer' }],
    linesByAccount: { 'USAV-Buyer': [
      { sourceOrderId: 'E-1', sku: 'A', quantity: 2 },
      { sourceOrderId: 'E-2', sku: 'B' },
    ] },
  });
  const r = await syncEbayPurchasesToReceiving(ORG, deps);
  assert.equal(r.linesFetched, 2);
  assert.equal(r.ingested, 2);
  assert.equal(r.created, 2);
  assert.equal(ingested[0].accountLabel, 'USAV-Buyer');
  assert.equal(ingested[0].sourceType, 'ebay');
  assert.equal(ingested[0].quantityExpected, 2);
  assert.equal(ingested[1].orderNumber, 'E-2'); // falls back to sourceOrderId
  assert.deepEqual(cursorsSet, ['ebay_purchases:' + ORG + ':USAV-Buyer']);
});

test('a line with no order id is skipped; others still ingest', async () => {
  const { deps, ingested } = fakes({
    accounts: [{ accountName: 'B1' }],
    linesByAccount: { B1: [{ sourceOrderId: '' }, { sourceOrderId: 'E-9', sku: 'X' }] },
  });
  const r = await syncEbayPurchasesToReceiving(ORG, deps);
  assert.equal(r.ingested, 1);
  assert.equal(ingested[0].sourceOrderId, 'E-9');
  assert.equal(r.errors.length, 1);
});

test('per-line ingest error is isolated', async () => {
  const { deps } = fakes({
    accounts: [{ accountName: 'B1' }],
    linesByAccount: { B1: [{ sourceOrderId: 'E-1' }, { sourceOrderId: 'E-2' }] },
    ingestThrowsFor: 'E-1',
  });
  const r = await syncEbayPurchasesToReceiving(ORG, deps);
  assert.equal(r.ingested, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /E-1/);
});

test('a fetch failure skips the account (no cursor advance) but not the org', async () => {
  const { deps, cursorsSet } = fakes({
    accounts: [{ accountName: 'bad' }, { accountName: 'good' }],
    linesByAccount: { good: [{ sourceOrderId: 'E-1' }] },
    fetchThrowsFor: 'bad',
  });
  const r = await syncEbayPurchasesToReceiving(ORG, deps);
  assert.equal(r.accounts, 2);
  assert.equal(r.ingested, 1);
  assert.ok(r.errors.some((e) => /bad: fetch failed/.test(e)));
  assert.deepEqual(cursorsSet, ['ebay_purchases:' + ORG + ':good'], 'failed account cursor not advanced');
});
