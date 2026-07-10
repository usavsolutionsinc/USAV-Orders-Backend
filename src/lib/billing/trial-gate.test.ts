/**
 * Trial-expiry gate — decision logic (Tier-0 #1, roi-execution/01).
 *
 * The gate is wired into both Node-runtime choke points (withAuth → 402,
 * requirePermission → redirect); these tests pin the decision itself DB-free
 * via injected deps, so the owner can flip TRIAL_ENFORCEMENT with confidence:
 *   - enforcement OFF                          → never blocked, no DB read
 *   - exempt paths (billing/auth/signin)       → never blocked, no DB read
 *   - trial plan + trial_ends_at in the past   → BLOCKED
 *   - trial plan + trial_ends_at in the future → allowed
 *   - paid/enterprise plan                     → structurally immune
 *   - unknown org (null)                       → allowed (fail-open)
 */

import { test } from 'node:test';
import { strictEqual } from 'node:assert';

import {
  isTrialBlocked,
  isTrialExpired,
  isTrialPathExempt,
  type TrialGateDeps,
} from './trial-gate';

const ORG = '11111111-1111-1111-1111-111111111111';
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

/**
 * Deps with sensible defaults (enforcement ON, org is an expired trial) so
 * each test overrides only the axis it exercises. `getOrgCalls` counts DB
 * reads so the short-circuit contract is pinned, not just the verdict.
 */
function deps(over: Partial<TrialGateDeps> = {}): TrialGateDeps & { getOrgCalls: () => number } {
  let calls = 0;
  const base: TrialGateDeps = {
    enforced: () => true,
    getOrg: async () => {
      calls += 1;
      return { plan: 'trial', trialEndsAt: PAST };
    },
  };
  return { ...base, ...over, getOrgCalls: () => calls };
}

test('enforcement OFF → never blocked and NO DB read (hot-path contract)', async () => {
  const d = deps({ enforced: () => false });
  strictEqual(await isTrialBlocked(ORG, '/receiving', d), false);
  strictEqual(d.getOrgCalls(), 0);
});

test('exempt paths stay reachable with an expired trial — and skip the DB read', async () => {
  for (const path of [
    '/settings/billing',
    '/settings/billing/portal',
    '/api/billing/checkout',
    '/api/auth/session',
    '/signin',
    '/not-authorized',
  ]) {
    const d = deps();
    strictEqual(await isTrialBlocked(ORG, path, d), false, path);
    strictEqual(d.getOrgCalls(), 0, `${path} must not read the DB`);
  }
});

test('a non-exempt path with a sibling prefix is NOT exempt (no prefix over-match)', () => {
  // startsWith is applied with a trailing slash, so /api/authz ≠ /api/auth.
  strictEqual(isTrialPathExempt('/api/authz/evil'), false);
  strictEqual(isTrialPathExempt('/settings/billing-fake'), false);
});

test('expired trial on a protected path → BLOCKED', async () => {
  const d = deps();
  strictEqual(await isTrialBlocked(ORG, '/receiving', d), true);
  strictEqual(d.getOrgCalls(), 1);
});

test('trial with time remaining → allowed', async () => {
  const d = deps({ getOrg: async () => ({ plan: 'trial', trialEndsAt: FUTURE }) });
  strictEqual(await isTrialBlocked(ORG, '/receiving', d), false);
});

test('trial with no trial_ends_at set → allowed (no date, no expiry)', async () => {
  const d = deps({ getOrg: async () => ({ plan: 'trial', trialEndsAt: null }) });
  strictEqual(await isTrialBlocked(ORG, '/receiving', d), false);
});

test('paid plans are structurally immune, even with a stale past trial date', async () => {
  for (const plan of ['starter', 'growth', 'pro', 'enterprise']) {
    const d = deps({ getOrg: async () => ({ plan, trialEndsAt: PAST }) });
    strictEqual(await isTrialBlocked(ORG, '/receiving', d), false, plan);
  }
});

test('unknown org (getOrg → null) → allowed (fail-open, never lock out on a bad lookup)', async () => {
  const d = deps({ getOrg: async () => null });
  strictEqual(await isTrialBlocked(ORG, '/receiving', d), false);
});

test('isTrialExpired is the pure predicate: only trial + past date is true', () => {
  strictEqual(isTrialExpired({ plan: 'trial', trialEndsAt: PAST }), true);
  strictEqual(isTrialExpired({ plan: 'trial', trialEndsAt: FUTURE }), false);
  strictEqual(isTrialExpired({ plan: 'trial', trialEndsAt: null }), false);
  strictEqual(isTrialExpired({ plan: 'pro', trialEndsAt: PAST }), false);
});
