/**
 * Entitlement-gate dispatcher for the `withAuth({ feature })` hook.
 *
 * `withAuth` stays decoupled from any one feature: it just passes the opt's
 * `feature` name and the org id here, and we route to that feature's gate. A
 * feature with no registered gate is NEVER blocked (pass-through) — so adding
 * `feature: 'x'` to a route can only start gating once a gate for `x` is wired
 * AND that gate's own enforcement flag is on.
 *
 * PERMISSIVE BY DEFAULT. The only feature wired today is `studio`, whose gate
 * is dormant until STUDIO_ENTITLEMENT_ENFORCED is set (see studio-gate.ts), so
 * this dispatcher returns `false` (allowed) for every request out of the box.
 */

import type { Entitlements } from './plans';
import type { OrgId } from '../tenancy/constants';
import { isStudioGated } from './studio-gate';
import { makePlanFeatureGate } from './plan-feature-gate';

export type EntitlementFeature = keyof Entitlements['features'];

/**
 * Map of feature → its block-decision fn. Only features with bespoke
 * enforcement (flag + exemptions + override) are listed; everything else is
 * implicitly never-gated by the wrapper.
 *
 * `studio` has its own bespoke gate (STUDIO_ENTITLEMENT_ENFORCED). The Growth+
 * plan features (walkIn, sourcing, support, aiChat) share one generic plan-tier
 * gate behind PLAN_FEATURE_ENFORCED — all dormant + fail-open by default, so
 * wiring them changes nothing until enforcement is explicitly turned on.
 */
const FEATURE_GATES: Partial<
  Record<EntitlementFeature, (orgId: OrgId | null | undefined) => Promise<boolean>>
> = {
  studio: isStudioGated,
  walkIn: makePlanFeatureGate('walkIn'),
  sourcing: makePlanFeatureGate('sourcing'),
  support: makePlanFeatureGate('support'),
  aiChat: makePlanFeatureGate('aiChat'),
};

/**
 * True if the request should be blocked for lacking `feature`. Returns false
 * (allowed) for any feature without a registered gate, and each gate is itself
 * permissive-by-default + fail-open, so this never hard-locks a tenant out.
 */
export async function isFeatureGated(
  feature: EntitlementFeature,
  orgId: OrgId | null | undefined,
): Promise<boolean> {
  const gate = FEATURE_GATES[feature];
  if (!gate) return false;
  return gate(orgId);
}
