import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBoundInboundSources, validateInboundPublish, type InboundPublishDeps } from './publish-validation';
import type { StationConfig } from '@/lib/stations/contract';

function cfg(...instances: Array<{ sourceId: string; inbound?: string }>): StationConfig {
  return {
    slots: {
      queue: instances.map((i, n) => ({
        id: `blk_${n}`,
        block: 'checklist',
        source: { id: i.sourceId, filters: i.inbound ? { inbound: i.inbound } : {} },
      })),
    },
  };
}

const okDeps = (over: Partial<InboundPublishDeps> = {}): InboundPublishDeps => ({
  isFlagOn: async () => true,
  hasConnectedBuyerAccount: async () => true,
  getEnabledSources: async () => ['zoho', 'ebay'],
  ...over,
});

test('collectBoundInboundSources: eBay-fixed source needs eBay', () => {
  const b = collectBoundInboundSources(cfg({ sourceId: 'receiving.incoming_ebay' }));
  assert.equal(b.needsEbay, true);
  assert.ok(b.pinnedSources.has('ebay'));
});

test('collectBoundInboundSources: incoming_all with inbound=ebay filter needs eBay', () => {
  const b = collectBoundInboundSources(cfg({ sourceId: 'receiving.incoming_all', inbound: 'ebay' }));
  assert.equal(b.needsEbay, true);
});

test('collectBoundInboundSources: incoming_all default (all) pins nothing', () => {
  const b = collectBoundInboundSources(cfg({ sourceId: 'receiving.incoming_all' }));
  assert.equal(b.needsEbay, false);
  assert.equal(b.pinnedSources.size, 0);
});

test('collectBoundInboundSources: legacy config → empty', () => {
  const b = collectBoundInboundSources({ slots: 'legacy' });
  assert.equal(b.needsEbay, false);
  assert.equal(b.pinnedSources.size, 0);
});

test('non-inbound config → no DB checks, no issues', async () => {
  let called = false;
  const issues = await validateInboundPublish(cfg({ sourceId: 'po_gmail.unmatched_emails' }), okDeps({
    isFlagOn: async () => { called = true; return false; },
  }));
  assert.deepEqual(issues, []);
  assert.equal(called, false, 'must short-circuit before DB checks');
});

test('eBay source with flag on + buyer account + enabled → OK', async () => {
  const issues = await validateInboundPublish(cfg({ sourceId: 'receiving.incoming_ebay' }), okDeps());
  assert.deepEqual(issues, []);
});

test('eBay source without flag → blocked', async () => {
  const issues = await validateInboundPublish(cfg({ sourceId: 'receiving.incoming_ebay' }), okDeps({ isFlagOn: async () => false }));
  assert.ok(issues.some((i) => /incoming_universal/.test(i)));
});

test('eBay source without a connected buyer account → blocked', async () => {
  const issues = await validateInboundPublish(cfg({ sourceId: 'receiving.awaiting_zoho_link' }), okDeps({ hasConnectedBuyerAccount: async () => false }));
  assert.ok(issues.some((i) => /buyer account/.test(i)));
});

test('pinned source not in enabledSources → blocked', async () => {
  const issues = await validateInboundPublish(cfg({ sourceId: 'receiving.incoming_zoho' }), okDeps({ getEnabledSources: async () => ['ebay'] }));
  assert.ok(issues.some((i) => /"zoho" is not enabled/.test(i)));
});

test('Zoho-only template (incoming_all + awaiting_tracking, all) → OK, no eBay gate', async () => {
  let flagChecked = false;
  const config = cfg({ sourceId: 'receiving.incoming_all' }, { sourceId: 'receiving.awaiting_tracking_pos' });
  const issues = await validateInboundPublish(config, okDeps({ isFlagOn: async () => { flagChecked = true; return false; } }));
  assert.deepEqual(issues, []);
  assert.equal(flagChecked, false, 'no eBay binding → flag never checked');
});
