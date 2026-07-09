import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupAmazonReturnByTracking,
  type ReturnsLookupDeps,
} from './returns-lookup';
import type { AmazonAccount } from './client';
import type { AmazonCredentials } from '@/lib/integrations/credentials';

// ── Fakes ─────────────────────────────────────────────────────────────────────
const ACCOUNT = { id: 1, accountName: 'Main', sellerId: 'S1', region: 'NA' } as unknown as AmazonAccount;
const CREDS = { lwaClientId: 'id', lwaClientSecret: 'secret', refreshToken: 'r' } as unknown as AmazonCredentials;

function deps(overrides: Partial<ReturnsLookupDeps> = {}): ReturnsLookupDeps {
  return {
    loadAccounts: async () => [ACCOUNT],
    loadCreds: async () => CREDS,
    callApi: async () => ({}) as any,
    ...overrides,
  };
}

const RETURN_ITEM = {
  returnId: 'RET-123',
  status: 'RECEIVED',
  returnMetadata: { rmaId: 'RMA-9' },
  marketplaceChannelDetails: { customerOrderId: '111-2222222-3333333' },
  reverseTrackingInfo: { trackingId: '1Z-REVERSE', carrierName: 'UPS' },
  merchantSku: 'SKU-A',
  channelSku: 'AMZ-SKU-A',
};

test('matched — maps reverseTrackingInfo / rma / customerOrderId / skus from getReturn', async () => {
  const calls: string[] = [];
  const res = await lookupAmazonReturnByTracking(
    'org-1',
    '1Z-REVERSE',
    deps({
      callApi: (async (_a: unknown, _c: unknown, opts: { operation: string }) => {
        calls.push(opts.operation);
        if (opts.operation === 'listReturns') return { returns: [{ returnId: 'RET-123' }] };
        return RETURN_ITEM; // getReturn full payload
      }) as ReturnsLookupDeps['callApi'],
    }),
  );

  assert.equal(res.matched, true);
  assert.equal(res.unsupported, false);
  assert.equal(res.match?.returnId, 'RET-123');
  assert.equal(res.match?.rmaId, 'RMA-9');
  assert.equal(res.match?.customerOrderId, '111-2222222-3333333');
  assert.equal(res.match?.reverseTrackingId, '1Z-REVERSE');
  assert.equal(res.match?.carrierName, 'UPS');
  assert.equal(res.match?.merchantSku, 'SKU-A');
  assert.equal(res.match?.channelSku, 'AMZ-SKU-A');
  // Both listReturns and getReturn were called.
  assert.deepEqual(calls, ['listReturns', 'getReturn']);
});

test('matched — falls back to the list item when getReturn throws', async () => {
  const res = await lookupAmazonReturnByTracking(
    'org-1',
    '1Z-REVERSE',
    deps({
      callApi: (async (_a: unknown, _c: unknown, opts: { operation: string }) => {
        if (opts.operation === 'listReturns') return { returns: [RETURN_ITEM] };
        throw new Error('getReturn transient');
      }) as ReturnsLookupDeps['callApi'],
    }),
  );
  assert.equal(res.matched, true);
  assert.equal(res.match?.rmaId, 'RMA-9');
});

test('no-match — account queryable but zero returns', async () => {
  const res = await lookupAmazonReturnByTracking(
    'org-1',
    '1Z-REVERSE',
    deps({
      callApi: (async () => ({ returns: [] })) as ReturnsLookupDeps['callApi'],
    }),
  );
  assert.equal(res.matched, false);
  assert.equal(res.unsupported, false);
});

test('unsupported — a 403 (not enrolled in External Fulfillment) marks it unsupported', async () => {
  const res = await lookupAmazonReturnByTracking(
    'org-1',
    '1Z-REVERSE',
    deps({
      callApi: (async () => {
        throw new Error('SP-API listReturns failed: HTTP 403 Access to requested resource is denied');
      }) as ReturnsLookupDeps['callApi'],
    }),
  );
  assert.equal(res.matched, false);
  assert.equal(res.unsupported, true);
});

test('unsupported — no connected Amazon account', async () => {
  const res = await lookupAmazonReturnByTracking(
    'org-1',
    '1Z-REVERSE',
    deps({ loadAccounts: async () => [] }),
  );
  assert.equal(res.matched, false);
  assert.equal(res.unsupported, true);
});

test('a genuine (non-auth) SP-API error propagates to the caller', async () => {
  await assert.rejects(
    lookupAmazonReturnByTracking(
      'org-1',
      '1Z-REVERSE',
      deps({
        callApi: (async () => {
          throw new Error('SP-API listReturns failed: HTTP 500 internal');
        }) as ReturnsLookupDeps['callApi'],
      }),
    ),
    /HTTP 500/,
  );
});

test('empty tracking short-circuits to no-match without hitting the API', async () => {
  let called = false;
  const res = await lookupAmazonReturnByTracking(
    'org-1',
    '   ',
    deps({ callApi: (async () => { called = true; return {}; }) as ReturnsLookupDeps['callApi'] }),
  );
  assert.equal(res.matched, false);
  assert.equal(called, false);
});
