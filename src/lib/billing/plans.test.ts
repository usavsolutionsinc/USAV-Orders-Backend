/**
 * Plan catalog invariants — make sure the entitlements ladder is monotonic
 * and that planFromPriceId is the inverse of PLAN_PRICE_IDS lookup.
 *
 * These prevent the "we accidentally let trial users export audit logs"
 * class of regression when someone touches plans.ts in a hurry.
 */

import { test } from 'node:test';
import { strictEqual } from 'node:assert';

import { entitlementsForPlan, planFromPriceId, PLAN_PRICE_IDS } from './plans';

test('trial cannot do anything growth+ can do exclusively', () => {
  const trial = entitlementsForPlan('trial');
  const growth = entitlementsForPlan('growth');
  // Features that growth unlocks must be off on trial.
  strictEqual(growth.features.fba, true);
  strictEqual(trial.features.fba, false);
  strictEqual(growth.features.advancedRoles, true);
  strictEqual(trial.features.advancedRoles, false);
});

test('every plan grants the studio capability by default (permissive — revokes nothing)', () => {
  // Track 2: the studio entitlement is granted on every tier so turning the
  // gate on never locks an existing org out. Tighten per-tier later if the
  // plan ladder is split into Tracker/Ops/Studio.
  for (const plan of ['trial', 'starter', 'growth', 'pro', 'enterprise'] as const) {
    strictEqual(entitlementsForPlan(plan).features.studio, true, `${plan} should include studio`);
  }
});

test('enterprise has everything pro has', () => {
  const pro = entitlementsForPlan('pro');
  const ent = entitlementsForPlan('enterprise');
  for (const [k, v] of Object.entries(pro.features)) {
    if (v) strictEqual((ent.features as Record<string, boolean>)[k], true, `enterprise should keep ${k}`);
  }
  // And enterprise adds SSO + priority support.
  strictEqual(ent.features.sso, true);
  strictEqual(ent.features.prioritySupport, true);
});

test('staff ceilings are monotonic except for unlimited (0) on enterprise', () => {
  const order = ['trial', 'starter', 'growth', 'pro'] as const;
  let last = 0;
  for (const plan of order) {
    const ent = entitlementsForPlan(plan);
    if (last !== 0) {
      strictEqual(
        ent.maxStaff >= last,
        true,
        `${plan} should have at least as many staff seats as the prior tier`,
      );
    }
    last = ent.maxStaff;
  }
  strictEqual(entitlementsForPlan('enterprise').maxStaff, 0); // 0 = unlimited
});

test('planFromPriceId roundtrips PLAN_PRICE_IDS', () => {
  process.env.STRIPE_PRICE_STARTER = 'price_starter_test';
  process.env.STRIPE_PRICE_GROWTH = 'price_growth_test';
  // re-import to pick up env changes? PLAN_PRICE_IDS is computed at module
  // load — we can only assert the planFromPriceId path for ids present at
  // load time. For env-set ids loaded earlier this still works.
  for (const [plan, priceId] of Object.entries(PLAN_PRICE_IDS)) {
    if (!priceId) continue;
    strictEqual(planFromPriceId(priceId), plan);
  }
  strictEqual(planFromPriceId('price_unknown'), null);
});
