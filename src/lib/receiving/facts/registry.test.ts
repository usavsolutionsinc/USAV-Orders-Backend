import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFactPayload,
  safeParseFactPayload,
  getFactDef,
  isKnownFactKind,
  listKnownFactKinds,
} from './registry';

test('parseFactPayload validates a known kind and strips unknown keys', () => {
  const out = parseFactPayload('marketplace_listing', {
    sourcePlatform: 'ebay',
    listingUrl: 'https://example.com/x',
    bogus: 'dropped',
  });
  assert.deepEqual(out, { sourcePlatform: 'ebay', listingUrl: 'https://example.com/x' });
});

test('parseFactPayload throws on a malformed payload', () => {
  // offeredAmountCents must be a non-negative integer
  assert.throws(() => parseFactPayload('trade_in_valuation', { offeredAmountCents: -5 }));
  assert.throws(() => parseFactPayload('marketplace_listing', { skuPlatformIdRow: 'not-a-number' }));
});

test('repair_service applies its default flag', () => {
  assert.deepEqual(parseFactPayload('repair_service', {}), { isRepairService: true });
});

test('unknown (org-custom) kind falls back to a permissive passthrough', () => {
  assert.equal(isKnownFactKind('consignment_terms'), false);
  const def = getFactDef('consignment_terms');
  assert.equal(def.label, 'consignment_terms');
  // any JSON object is accepted + preserved
  const out = parseFactPayload('consignment_terms', { feePct: 12, partner: 'acme' });
  assert.deepEqual(out, { feePct: 12, partner: 'acme' });
});

test('safeParseFactPayload reports success/failure without throwing', () => {
  assert.equal(safeParseFactPayload('trade_in_valuation', { offeredAmountCents: 100 }).success, true);
  assert.equal(safeParseFactPayload('trade_in_valuation', { offeredAmountCents: -1 }).success, false);
});

test('listKnownFactKinds enumerates the built-ins with labels', () => {
  const kinds = listKnownFactKinds();
  assert.equal(kinds.length, 5);
  assert.ok(kinds.every((k) => typeof k.label === 'string' && k.label.length > 0));
  assert.ok(kinds.some((k) => k.kind === 'marketplace_listing'));
  assert.ok(kinds.some((k) => k.kind === 'ebay_purchase'));
});

test('ebay_purchase validates and strips unknown keys', () => {
  const out = parseFactPayload('ebay_purchase', {
    legacyOrderId: '12-34567-89012',
    sellerUsername: 'acme_deals',
    purchaseOrderStatus: 'PAID',
    bogus: 'dropped',
  });
  assert.deepEqual(out, {
    legacyOrderId: '12-34567-89012',
    sellerUsername: 'acme_deals',
    purchaseOrderStatus: 'PAID',
  });
});
