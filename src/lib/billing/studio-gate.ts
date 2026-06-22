/**
 * Operations Studio entitlement gate — the MECHANISM (Part-2 Track 2).
 *
 * Decides whether a tenant may reach the Studio surface (/studio + the
 * /api/studio/* routes) based on its plan's `studio` capability. It is the
 * read-time enforcement layer for the `features.studio` flag declared in
 * src/lib/billing/plans.ts.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PERMISSIVE BY DEFAULT. This whole layer is a NO-OP until
 * `STUDIO_ENTITLEMENT_ENFORCED` is explicitly set. With it off:
 *   - `studioEntitlementEnforced()` returns false,
 *   - `isStudioGated()` returns false with NO database read, and
 *   - every Studio route/page behaves EXACTLY as before (RBAC-only).
 * No existing org loses Studio access from this change. Enforcement becomes
 * real later via an explicit flag flip alongside the Part-3 RLS work.
 *
 * COSMETIC UNTIL PART-3 RLS. On its own, plan-gating provides no tenant
 * isolation — a determined caller in a shared DB without RLS could still read
 * cross-tenant rows. Real isolation is the Part-3 critical path; this gate is
 * the entitlement/upsell surface, not a security boundary.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Three escape hatches keep it from ever locking out someone who should have
 * access, even once enforcement is on:
 *   1. Enforcement flag OFF  → always allowed (default).
 *   2. Dogfood/internal org  → always allowed (the deployment we run on).
 *   3. Per-org override flag  → `organization_feature_flags(flag='studio')`
 *      set true force-grants regardless of plan (staged manual grant without
 *      an env redeploy). The spec calls for honoring BOTH the plan catalog
 *      and the org-flag system; this is the org-flag side.
 *
 * Mirrors the trial-gate.ts pattern (flag-gated, short-circuits before any DB
 * read when off) so the hot auth path pays nothing while the feature is dormant.
 */

import { hasFeature } from './entitlements';
import { readOrgFeatureFlag } from '../feature-flags';
import { USAV_ORG_ID, type OrgId } from '../tenancy/constants';

/** Env var that flips Studio entitlement enforcement from dormant → live. */
export const STUDIO_ENFORCEMENT_ENV = 'STUDIO_ENTITLEMENT_ENFORCED';

/** Per-org override flag name in `organization_feature_flags`. */
export const STUDIO_ORG_FLAG = 'studio';

/**
 * The dogfood / internal org that runs the live deployment. It is exempt from
 * Studio gating ALWAYS — even with enforcement on and whatever its plan — so
 * we can never lock ourselves (or the consolidated internal tenant) out.
 * This is org #1 (USAV Solutions), the same id the
 * 2026-06-20d_consolidate_dogfood_org migration folds stray data onto.
 */
export const DOGFOOD_ORG_ID: OrgId = USAV_ORG_ID;

/**
 * True only when `STUDIO_ENTITLEMENT_ENFORCED` is explicitly truthy. Default
 * OFF — when off, the entire gate is a pass-through.
 */
export function studioEntitlementEnforced(): boolean {
  const v = (process.env[STUDIO_ENFORCEMENT_ENV] ?? '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** The dogfood/internal org is always exempt from Studio gating. */
export function isStudioExemptOrg(orgId: OrgId | null | undefined): boolean {
  return orgId === DOGFOOD_ORG_ID;
}

/**
 * Injectable collaborators so the resolver is unit-testable without a DB. The
 * defaults are the real impls; tests pass fakes that capture/return without I/O.
 */
export interface StudioGateDeps {
  enforced: () => boolean;
  isExempt: (orgId: OrgId | null | undefined) => boolean;
  readOverrideFlag: (orgId: OrgId, flag: string) => Promise<boolean | null>;
  planHasStudio: (orgId: OrgId) => Promise<boolean>;
}

const defaultDeps: StudioGateDeps = {
  enforced: studioEntitlementEnforced,
  isExempt: isStudioExemptOrg,
  readOverrideFlag: readOrgFeatureFlag,
  planHasStudio: (orgId) => hasFeature(orgId, 'studio'),
};

/**
 * True if this org should be BLOCKED from the Studio surface.
 *
 * Decision order (each clause short-circuits, cheapest first):
 *   1. enforcement off            → not gated (NO DB read).
 *   2. no org / dogfood org       → not gated.
 *   3. org-flag override = true   → not gated (force-grant).
 *   4. plan has `studio` feature  → not gated.
 *   5. otherwise                  → GATED.
 *
 * Returns `false` (allowed) on any infra error so a flaky DB read can never
 * hard-lock a tenant out of Studio — fail-open, consistent with the rest of
 * the feature-flag layer.
 */
export async function isStudioGated(
  orgId: OrgId | null | undefined,
  deps: StudioGateDeps = defaultDeps,
): Promise<boolean> {
  // 1. Dormant by default — short-circuit before any DB read.
  if (!deps.enforced()) return false;

  // 2. Unknown org (anonymous context) and the dogfood org are never gated.
  if (!orgId || deps.isExempt(orgId)) return false;

  try {
    // 3. Per-org override flag force-grants regardless of plan.
    const override = await deps.readOverrideFlag(orgId, STUDIO_ORG_FLAG);
    if (override === true) return false;

    // 4. Plan capability. Granted on every current plan by default, so this is
    //    only ever false once the plan ladder is tightened.
    if (await deps.planHasStudio(orgId)) return false;

    // 5. No exemption, no override, plan lacks the capability → gated.
    return true;
  } catch (err) {
    console.warn(
      `[studio-gate] entitlement check failed for ${orgId}; failing open:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
