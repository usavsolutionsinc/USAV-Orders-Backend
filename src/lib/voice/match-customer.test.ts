import test from 'node:test';
import assert from 'node:assert/strict';
import { toE164, lastDigits } from './normalize-phone';
import { matchCustomer, type MatchCustomerDeps } from './match-customer';
import type { MatchedCustomer } from './types';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';

// ── normalize-phone (pure) ────────────────────────────────────────────────────

test('toE164 normalizes 10-digit US numbers', () => {
  assert.equal(toE164('(415) 555-0100'), '+14155550100');
  assert.equal(toE164('415.555.0100'), '+14155550100');
});

test('toE164 handles a leading-1 11-digit and passes through E.164', () => {
  assert.equal(toE164('14155550100'), '+14155550100');
  assert.equal(toE164('+14155550100'), '+14155550100');
});

test('toE164 returns null for un-attributable input', () => {
  assert.equal(toE164(''), null);
  assert.equal(toE164(null), null);
  assert.equal(toE164('12345'), null);
});

test('lastDigits strips formatting to the trailing N', () => {
  assert.equal(lastDigits('+1 (415) 555-0100'), '4155550100');
  assert.equal(lastDigits('555-0100', 10), '5550100');
});

// ── matchCustomer (Deps-injected, DB-free) ────────────────────────────────────

function fakes(overrides: Partial<MatchCustomerDeps> = {}): {
  deps: MatchCustomerDeps;
  calls: { customers: string[]; square: string[] };
} {
  const calls = { customers: [] as string[], square: [] as string[] };
  const deps: MatchCustomerDeps = {
    async lookupCustomers(_orgId, last10) {
      calls.customers.push(last10);
      return null;
    },
    async lookupSquare(_orgId, last10) {
      calls.square.push(last10);
      return null;
    },
    ...overrides,
  };
  return { deps, calls };
}

const HIT: MatchedCustomer = { name: 'Ada Lovelace', email: 'ada@x.io', phone: '+14155550100', source: 'customers' };

test('matchCustomer prefers an org-scoped customers hit and skips Square', async () => {
  const { deps, calls } = fakes({ lookupCustomers: async () => HIT });
  const result = await matchCustomer({ orgId: USAV_ORG_ID, e164: '+14155550100' }, deps);
  assert.deepEqual(result, HIT);
  assert.deepEqual(calls.square, [], 'Square should not be queried when customers matched');
});

test('matchCustomer falls back to Square when customers misses', async () => {
  const squareHit: MatchedCustomer = { name: 'Grace', email: null, phone: '+14155550100', source: 'square' };
  const { deps } = fakes({ lookupSquare: async () => squareHit });
  const result = await matchCustomer({ orgId: USAV_ORG_ID, e164: '+14155550100' }, deps);
  assert.equal(result?.source, 'square');
});

test('matchCustomer matches on last-10 even when normalization fails', async () => {
  const seen: string[] = [];
  const { deps } = fakes({
    lookupCustomers: async (_orgId, last10) => {
      seen.push(last10);
      return HIT;
    },
  });
  // e164 null (unattributable) but a raw 10-digit number is present.
  const result = await matchCustomer({ orgId: USAV_ORG_ID, e164: null, rawNumber: '(415) 555-0100' }, deps);
  assert.deepEqual(result, HIT);
  assert.deepEqual(seen, ['4155550100']);
});

test('matchCustomer returns null with too few digits to match', async () => {
  const { deps, calls } = fakes();
  const result = await matchCustomer({ orgId: USAV_ORG_ID, e164: null, rawNumber: '0100' }, deps);
  assert.equal(result, null);
  assert.deepEqual(calls.customers, [], 'should not query with < 10 digits');
});
