import test from 'node:test';
import assert from 'node:assert/strict';
import { isBillingDelinquent, DELINQUENT_STATUSES, type DelinquencyDeps } from './delinquency';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-4000-8000-000000000001' as OrgId;

interface Captured { lookups: OrgId[] }

function fakes(status: string | null) {
  const cap: Captured = { lookups: [] };
  const deps: DelinquencyDeps = {
    getSubscription: async (orgId) => {
      cap.lookups.push(orgId);
      return status === null ? null : { status };
    },
  };
  return { deps, cap };
}

test('isBillingDelinquent: past_due is delinquent', async () => {
  const { deps, cap } = fakes('past_due');
  assert.equal(await isBillingDelinquent(ORG, deps), true);
  assert.deepEqual(cap.lookups, [ORG]); // org threaded through, exactly one read
});

test('isBillingDelinquent: every DELINQUENT_STATUSES value is delinquent', async () => {
  for (const status of DELINQUENT_STATUSES) {
    const { deps } = fakes(status);
    assert.equal(await isBillingDelinquent(ORG, deps), true, status);
  }
});

test('isBillingDelinquent: active / trialing / canceled / incomplete are NOT delinquent', async () => {
  for (const status of ['active', 'trialing', 'canceled', 'incomplete']) {
    const { deps } = fakes(status);
    assert.equal(await isBillingDelinquent(ORG, deps), false, status);
  }
});

test('isBillingDelinquent: no mirror row (never subscribed) is NOT delinquent', async () => {
  const { deps, cap } = fakes(null);
  assert.equal(await isBillingDelinquent(ORG, deps), false);
  assert.equal(cap.lookups.length, 1);
});
