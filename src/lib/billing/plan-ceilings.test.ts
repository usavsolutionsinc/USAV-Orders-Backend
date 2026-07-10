/**
 * Plan quantity ceilings — decision logic (DB-free via injected deps).
 *
 * Pins the dormant-by-default / fail-open contract of wouldExceedPlanCeiling():
 *   - flag OFF            → allowed, and NO collaborator (DB) reads happen
 *   - over the ceiling    → EXCEEDED
 *   - under the ceiling   → allowed
 *   - ceiling 0           → unlimited (allowed, usage never counted)
 *   - dogfood/exempt org  → allowed even when over
 *   - collaborator throw  → fail-open (allowed)
 */

import { test } from 'node:test';
import { strictEqual } from 'node:assert';

import {
  wouldExceedPlanCeiling,
  planLimitResponseBody,
  type PlanCeilingDeps,
} from './plan-ceilings';
import { PLAN_FEATURE_EXEMPT_ORG_ID } from './plan-feature-gate';

const ORG = '11111111-1111-1111-1111-111111111111';

/**
 * Deps with sensible defaults (enforcement ON, not exempt, ceiling 5, usage 0)
 * so each test overrides only the axis it exercises. Also records collaborator
 * calls so the no-DB-read-when-dormant contract is assertable.
 */
function deps(over: Partial<PlanCeilingDeps> = {}) {
  const calls: string[] = [];
  const d: PlanCeilingDeps = {
    enforced: () => true,
    isExempt: (orgId) => orgId === PLAN_FEATURE_EXEMPT_ORG_ID,
    ceilingFor: async () => {
      calls.push('ceilingFor');
      return 5;
    },
    countUsage: async () => {
      calls.push('countUsage');
      return 0;
    },
    ...over,
  };
  return { d, calls };
}

test('flag OFF → allowed, with NO DB reads', async () => {
  const { d, calls } = deps({ enforced: () => false });
  const exceeded = await wouldExceedPlanCeiling(ORG, 'maxStaff', d);
  strictEqual(exceeded, false);
  strictEqual(calls.length, 0);
});

test('over the ceiling → exceeded', async () => {
  const { d } = deps({ ceilingFor: async () => 5, countUsage: async () => 5 });
  strictEqual(await wouldExceedPlanCeiling(ORG, 'maxStaff', d), true);
});

test('well over the ceiling → exceeded', async () => {
  const { d } = deps({ ceilingFor: async () => 5, countUsage: async () => 12 });
  strictEqual(await wouldExceedPlanCeiling(ORG, 'maxMonthlyOrders', d), true);
});

test('under the ceiling → allowed', async () => {
  const { d } = deps({ ceilingFor: async () => 5, countUsage: async () => 4 });
  strictEqual(await wouldExceedPlanCeiling(ORG, 'maxWarehouses', d), false);
});

test('ceiling 0 = unlimited → allowed, usage never counted', async () => {
  const { d, calls } = deps({
    ceilingFor: async () => 0,
    countUsage: async () => 1_000_000,
  });
  strictEqual(await wouldExceedPlanCeiling(ORG, 'maxMonthlyOrders', d), false);
  strictEqual(calls.includes('countUsage'), false);
});

test('dogfood/exempt org → allowed even when over the ceiling', async () => {
  const { d } = deps({ ceilingFor: async () => 1, countUsage: async () => 99 });
  strictEqual(
    await wouldExceedPlanCeiling(PLAN_FEATURE_EXEMPT_ORG_ID, 'maxStaff', d),
    false,
  );
});

test('anonymous / unknown org (null) → allowed', async () => {
  const { d } = deps({ countUsage: async () => 99, ceilingFor: async () => 1 });
  strictEqual(await wouldExceedPlanCeiling(null, 'maxStaff', d), false);
});

test('fail-open when the ceiling lookup throws', async () => {
  const { d } = deps({
    ceilingFor: async () => {
      throw new Error('db down');
    },
  });
  strictEqual(await wouldExceedPlanCeiling(ORG, 'maxStaff', d), false);
});

test('fail-open when the usage count throws', async () => {
  const { d } = deps({
    countUsage: async () => {
      throw new Error('db down');
    },
  });
  strictEqual(await wouldExceedPlanCeiling(ORG, 'maxMonthlyOrders', d), false);
});

test('planLimitResponseBody carries the canonical shape', () => {
  const body = planLimitResponseBody('maxStaff');
  strictEqual(body.ok, false);
  strictEqual(body.error, 'PLAN_LIMIT');
  strictEqual(body.limit, 'maxStaff');
  strictEqual(body.upgrade, true);
});
