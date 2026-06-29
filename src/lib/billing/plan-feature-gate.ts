/**
 * Generic plan-tier entitlement gate for the simple "Growth+" paid features
 * (walkIn, sourcing, support, aiChat).
 *
 * These four features need no bespoke per-feature logic like Studio's — the
 * rule is uniformly "the tenant's plan must include this feature" — so instead
 * of one hand-written gate per feature they all share this factory and ONE
 * enforcement flag (PLAN_FEATURE_ENFORCED).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PERMISSIVE BY DEFAULT (mirrors studio-gate.ts). Every gate this factory
 * produces is a NO-OP until `PLAN_FEATURE_ENFORCED` is explicitly set. With it
 * off the gate returns false (allowed) with NO database read, so a route that
 * declares `feature: 'sourcing'` etc. behaves EXACTLY as before (RBAC-only)
 * and nothing breaks for the dogfood/internal org until enforcement is flipped
 * on alongside the Part-3 RLS work.
 *
 * Three escape hatches keep it from ever locking out someone who should have
 * access, even once enforcement is on:
 *   1. Enforcement flag OFF  → always allowed (default).
 *   2. Dogfood/internal org  → always allowed (the deployment we run on).
 *   3. Per-org override flag  → `organization_feature_flags(flag=<feature>)`
 *      set true force-grants regardless of plan (staged manual grant without
 *      an env redeploy).
 *
 * Fail-open: any infra error resolves to "allowed" so a flaky DB read can
 * never hard-lock a tenant out of a feature.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { hasFeature } from './entitlements';
import { readOrgFeatureFlag } from '../feature-flags';
import { USAV_ORG_ID, type OrgId } from '../tenancy/constants';
import type { EntitlementFeature } from './feature-gate';

/** Env var that flips Growth+ plan-feature enforcement from dormant → live. */
export const PLAN_FEATURE_ENFORCEMENT_ENV = 'PLAN_FEATURE_ENFORCED';

/**
 * The dogfood / internal org that runs the live deployment — exempt from
 * plan-feature gating ALWAYS, so we can never lock ourselves out. Org #1.
 */
export const PLAN_FEATURE_EXEMPT_ORG_ID: OrgId = USAV_ORG_ID;

/**
 * True only when `PLAN_FEATURE_ENFORCED` is explicitly truthy. Default OFF —
 * when off, every gate from this factory is a pass-through.
 */
export function planFeatureEnforced(): boolean {
  const v = (process.env[PLAN_FEATURE_ENFORCEMENT_ENV] ?? '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** The dogfood/internal org is always exempt from plan-feature gating. */
export function isPlanFeatureExemptOrg(orgId: OrgId | null | undefined): boolean {
  return orgId === PLAN_FEATURE_EXEMPT_ORG_ID;
}

/**
 * Build the block-decision fn for one Growth+ feature.
 *
 * Decision order (each clause short-circuits, cheapest first):
 *   1. enforcement off            → not gated (NO DB read).
 *   2. no org / dogfood org       → not gated.
 *   3. org-flag override = true   → not gated (force-grant).
 *   4. plan has <feature>         → not gated.
 *   5. otherwise                  → GATED.
 */
export function makePlanFeatureGate(
  feature: EntitlementFeature,
): (orgId: OrgId | null | undefined) => Promise<boolean> {
  return async function isGated(orgId: OrgId | null | undefined): Promise<boolean> {
    // 1. Dormant by default — short-circuit before any DB read.
    if (!planFeatureEnforced()) return false;

    // 2. Unknown org (anonymous context) and the dogfood org are never gated.
    if (!orgId || isPlanFeatureExemptOrg(orgId)) return false;

    try {
      // 3. Per-org override flag force-grants regardless of plan.
      const override = await readOrgFeatureFlag(orgId, feature);
      if (override === true) return false;

      // 4. Plan capability.
      if (await hasFeature(orgId, feature)) return false;

      // 5. No exemption, no override, plan lacks the capability → gated.
      return true;
    } catch (err) {
      console.warn(
        `[plan-feature-gate] entitlement check failed for ${feature}/${orgId}; failing open:`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  };
}
