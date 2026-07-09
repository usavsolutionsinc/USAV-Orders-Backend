import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOneInboundPurchase, type SyncOneInboundDeps } from './sync-one-inbound';
import type { OrgId } from '@/lib/tenancy/constants';
import type { BuyerAccountRef, BuyerPurchaseLine } from '@/lib/ebay/purchase-client';
import type { InboundOrgSettings } from '@/lib/tenancy/settings';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

const ENABLED_SETTINGS: InboundOrgSettings = {
  enabledSources: ['zoho', 'ebay'],
  displaySourceAfterMerge: 'ebay',
  zohoOrderNumberFields: ['reference_number'],
  autoMergeSignals: ['tracking'],
  fuzzyMergeRequiresReview: true,
};

function baseDeps(overrides: Partial<SyncOneInboundDeps> = {}): SyncOneInboundDeps {
  return {
    isUniversalEnabled: async () => true,
    resolveSettings: async () => ENABLED_SETTINGS,
    listBuyerAccounts: async () => [{ accountName: 'Buyer-1' }],
    fetchPurchases: async () => [],
    ingest: (async () => ({ receivingLineId: 9, created: false, platformAccountId: 1, sourceType: 'ebay', sourceOrderId: 'E-1' })) as SyncOneInboundDeps['ingest'],
    getCursor: async () => null,
    syncAllEbay: async () => ({ orgId: ORG, accounts: 1, linesFetched: 0, ingested: 0, created: 0, errors: [] }),
    findShipmentId: async () => null,
    pollShipment: (async () => ({ ok: true, status: 'in_transit' })) as SyncOneInboundDeps['pollShipment'],
    ...overrides,
  };
}

test('flag off → blocked', async () => {
  const r = await syncOneInboundPurchase(ORG, { sourceType: 'ebay', sourceOrderId: 'E-1' }, baseDeps({
    isUniversalEnabled: async () => false,
  }));
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /not enabled/);
});

test('source disabled for org → blocked', async () => {
  const r = await syncOneInboundPurchase(ORG, { sourceType: 'ebay', sourceOrderId: 'E-1' }, baseDeps({
    resolveSettings: async () => ({ ...ENABLED_SETTINGS, enabledSources: ['zoho'] }),
  }));
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /not enabled/);
});

test('no buyer accounts → error', async () => {
  const r = await syncOneInboundPurchase(ORG, { sourceType: 'ebay', sourceOrderId: 'E-1' }, baseDeps({
    listBuyerAccounts: async () => [],
  }));
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /buyer account/);
});

test('ingests a matching fetched line for the order id', async () => {
  const ingested: BuyerPurchaseLine[] = [];
  const r = await syncOneInboundPurchase(ORG, { sourceType: 'ebay', sourceOrderId: 'E-42' }, baseDeps({
    fetchPurchases: async (_o, _a, _s) => [
      { sourceOrderId: 'E-42', sku: 'SKU-1' },
      { sourceOrderId: 'OTHER' },
    ],
    ingest: (async (_o, input) => {
      ingested.push({ sourceOrderId: input.sourceOrderId });
      return { receivingLineId: 1, created: true, platformAccountId: 2, sourceType: 'ebay', sourceOrderId: input.sourceOrderId };
    }) as SyncOneInboundDeps['ingest'],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.marketplace?.ingested, 1);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].sourceOrderId, 'E-42');
});

test('re-polls shipment when one is linked', async () => {
  let polled = false;
  const r = await syncOneInboundPurchase(ORG, { sourceType: 'ebay', sourceOrderId: 'E-1' }, baseDeps({
    fetchPurchases: async () => [{ sourceOrderId: 'E-1', sku: 'A' }],
    findShipmentId: async () => 55,
    pollShipment: (async () => { polled = true; return { ok: true, status: 'delivered' }; }) as SyncOneInboundDeps['pollShipment'],
  }));
  assert.equal(polled, true);
  assert.equal(r.shipment.polled, true);
  assert.equal(r.shipment.status, 'delivered');
});

test('amazon → not available yet', async () => {
  const r = await syncOneInboundPurchase(ORG, { sourceType: 'amazon', sourceOrderId: 'AMZ-1' }, baseDeps({
    resolveSettings: async () => ({ ...ENABLED_SETTINGS, enabledSources: ['zoho', 'ebay', 'amazon'] }),
  }));
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /Amazon/);
});
