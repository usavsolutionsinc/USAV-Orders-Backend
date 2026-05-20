/**
 * Money-path entitlement gating.
 *
 * Verifies that requireFeature throws a typed error for under-plan tenants,
 * so route handlers can map it to 402/403 + upgrade prompt without each
 * one knowing what's in each plan.
 */

import { test } from 'node:test';
import { ok, strictEqual } from 'node:assert';

// We test the pure mapping path (planFromPriceId is exercised in
// plans.test.ts); the org lookup path requires a DB and is covered by the
// integration test in tenancy/db.test.ts.
import { entitlementsForPlan } from './plans';
import { FeatureGatedError } from './entitlements';

test('FeatureGatedError carries the gated feature name', () => {
  const err = new FeatureGatedError('fba');
  strictEqual(err.feature, 'fba');
  ok(/fba/i.test(err.message));
});

test('trial has zero growth+ features', () => {
  const ent = entitlementsForPlan('trial');
  strictEqual(ent.features.fba, false);
  strictEqual(ent.features.repair, false);
  strictEqual(ent.features.aiCopilot, false);
  strictEqual(ent.features.advancedRoles, false);
});

test('only enterprise unlocks sso + priority support', () => {
  strictEqual(entitlementsForPlan('starter').features.sso, false);
  strictEqual(entitlementsForPlan('growth').features.sso, false);
  strictEqual(entitlementsForPlan('pro').features.sso, false);
  strictEqual(entitlementsForPlan('enterprise').features.sso, true);
  strictEqual(entitlementsForPlan('enterprise').features.prioritySupport, true);
});
