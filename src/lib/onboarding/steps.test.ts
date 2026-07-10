/**
 * DB-free unit tests for the onboarding step catalog
 * (src/lib/onboarding/steps.ts) — pure predicates over OnboardingStats plus the
 * entitlement filter. Run: npm run test:onboarding-steps
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_ONBOARDING_STATS,
  ONBOARDING_STEPS,
  completedStepCount,
  stepsForEntitlements,
  stepsForPlan,
  type OnboardingStats,
} from './steps';
import { entitlementsForPlan } from '@/lib/billing/plans';

function stats(overrides: Partial<OnboardingStats> = {}): OnboardingStats {
  return { ...EMPTY_ONBOARDING_STATS, ...overrides };
}

function step(id: string) {
  const found = ONBOARDING_STEPS.find((s) => s.id === id);
  assert.ok(found, `step ${id} exists in catalog`);
  return found;
}

test('brand-new org: every step pending', () => {
  const zero = stats();
  for (const s of ONBOARDING_STEPS) {
    assert.equal(s.doneWhen(zero), false, `${s.id} pending on zero stats`);
  }
  assert.equal(completedStepCount(ONBOARDING_STEPS, zero), 0);
});

test('connect: done iff an active integration exists', () => {
  assert.equal(step('connect').doneWhen(stats({ integrationsConnected: 1 })), true);
  assert.equal(step('connect').doneWhen(stats({ orders: 5, staff: 3 })), false);
});

test('order: done iff at least one order was ingested', () => {
  assert.equal(step('order').doneWhen(stats({ orders: 1 })), true);
  assert.equal(step('order').doneWhen(stats({ receivingLines: 4 })), false);
});

test('receive: done iff a receiving line exists', () => {
  assert.equal(step('receive').doneWhen(stats({ receivingLines: 1 })), true);
  assert.equal(step('receive').doneWhen(stats({ orders: 9 })), false);
});

test('scan: done iff the first inventory event exists', () => {
  assert.equal(step('scan').doneWhen(stats({ firstScanDone: true })), true);
  assert.equal(step('scan').doneWhen(stats({ orders: 9, receivingLines: 9 })), false);
});

test('invite: the signup admin alone does not complete it', () => {
  assert.equal(step('invite').doneWhen(stats({ staff: 1 })), false);
  assert.equal(step('invite').doneWhen(stats({ staff: 2 })), true);
});

test('completedStepCount tallies mixed progress', () => {
  const mixed = stats({ integrationsConnected: 2, orders: 10 });
  assert.equal(completedStepCount(ONBOARDING_STEPS, mixed), 2);
});

test('stepsForPlan(trial) shows the whole v1 ladder (maxStaff 5 keeps invite)', () => {
  const ids = stepsForPlan('trial').map((s) => s.id);
  assert.deepEqual(ids, ['connect', 'order', 'receive', 'scan', 'invite']);
});

test('every plan in the catalog resolves to a non-empty, ordered subset', () => {
  for (const plan of ['trial', 'starter', 'growth', 'pro', 'enterprise'] as const) {
    const steps = stepsForPlan(plan);
    assert.ok(steps.length > 0, `${plan} has steps`);
    // Filter preserves catalog order.
    const catalogOrder = ONBOARDING_STEPS.filter((s) => steps.includes(s)).map((s) => s.id);
    assert.deepEqual(steps.map((s) => s.id), catalogOrder, `${plan} preserves order`);
  }
});

test('entitlement filter: a single-seat plan hides the invite step', () => {
  const singleSeat = { ...entitlementsForPlan('starter'), maxStaff: 1 };
  const ids = stepsForEntitlements(singleSeat).map((s) => s.id);
  assert.equal(ids.includes('invite'), false);
  // maxStaff 0 = unlimited → invite stays.
  const unlimited = { ...entitlementsForPlan('enterprise'), maxStaff: 0 };
  assert.equal(stepsForEntitlements(unlimited).some((s) => s.id === 'invite'), true);
});

test('all-done stats self-dismiss the card (completed === visible length)', () => {
  const done = stats({
    orders: 3,
    receivingLines: 2,
    staff: 2,
    integrationsConnected: 1,
    firstScanDone: true,
  });
  const visible = stepsForPlan('trial');
  assert.equal(completedStepCount(visible, done), visible.length);
});
