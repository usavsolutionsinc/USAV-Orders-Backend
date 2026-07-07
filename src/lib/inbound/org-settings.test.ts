import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInboundSettings, isInboundSourceEnabled, type InboundSettingsDeps } from './org-settings';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as unknown as OrgId;

function fakeDeps(settings: unknown): InboundSettingsDeps {
  return { query: (async () => ({ rows: [{ settings }] })) as InboundSettingsDeps['query'] };
}

test('resolveInboundSettings returns schema defaults when unset', async () => {
  const s = await resolveInboundSettings(ORG, fakeDeps({}));
  assert.equal(s.displaySourceAfterMerge, 'ebay');
  assert.deepEqual(s.enabledSources, ['zoho', 'ebay']);
  assert.equal(s.fuzzyMergeRequiresReview, true);
  assert.deepEqual(s.autoMergeSignals, ['tracking', 'order_number']);
});

test('resolveInboundSettings reads a persisted inbound block', async () => {
  const s = await resolveInboundSettings(ORG, fakeDeps({
    inbound: { displaySourceAfterMerge: 'zoho', enabledSources: ['zoho'], autoMergeSignals: ['tracking'], fuzzyMergeRequiresReview: false },
  }));
  assert.equal(s.displaySourceAfterMerge, 'zoho');
  assert.deepEqual(s.enabledSources, ['zoho']);
  assert.deepEqual(s.autoMergeSignals, ['tracking']);
  assert.equal(s.fuzzyMergeRequiresReview, false);
  // unset field falls back to default
  assert.deepEqual(s.zohoOrderNumberFields, ['reference_number', 'notes']);
});

test('resolveInboundSettings tolerates a missing org (null) → defaults', async () => {
  const s = await resolveInboundSettings(null);
  assert.deepEqual(s.enabledSources, ['zoho', 'ebay']);
});

test('resolveInboundSettings tolerates invalid persisted settings → defaults', async () => {
  const s = await resolveInboundSettings(ORG, fakeDeps({ inbound: { displaySourceAfterMerge: 'shopify' } }));
  assert.equal(s.displaySourceAfterMerge, 'ebay'); // invalid enum → whole block falls back
});

test('isInboundSourceEnabled is registry + enabled-list gated (fail-closed)', async () => {
  const s = await resolveInboundSettings(ORG, fakeDeps({ inbound: { enabledSources: ['zoho', 'ebay'] } }));
  assert.equal(isInboundSourceEnabled(s, 'ebay'), true);
  assert.equal(isInboundSourceEnabled(s, 'EBAY'), true); // case-insensitive
  assert.equal(isInboundSourceEnabled(s, 'amazon'), false); // registered but not enabled
  assert.equal(isInboundSourceEnabled(s, 'shopify'), false); // unregistered → never enabled
});
