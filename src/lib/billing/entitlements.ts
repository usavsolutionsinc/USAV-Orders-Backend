/**
 * Resolve the current entitlements for a tenant.
 *
 * `getEntitlements(orgId)` returns a fully-resolved object combining the
 * tenant's plan with the catalog. Caches 60s in-process keyed by orgId;
 * webhook handlers that change a plan must invalidate via
 * `invalidateOrgCache(orgId)` from @/lib/tenancy.
 *
 * Routes/pages that are plan-gated should call `requireFeature(orgId, 'fba')`
 * which throws a typed error the API/page layer converts to 403 +
 * upgrade-prompt.
 */

import { getOrganization } from '../tenancy/organizations';
import type { OrgId } from '../tenancy/constants';
import { entitlementsForPlan, type Entitlements } from './plans';

export async function getEntitlements(orgId: OrgId): Promise<Entitlements> {
  const org = await getOrganization(orgId);
  if (!org) return entitlementsForPlan('trial');
  return entitlementsForPlan(org.plan);
}

export async function hasFeature(
  orgId: OrgId,
  feature: keyof Entitlements['features'],
): Promise<boolean> {
  const ent = await getEntitlements(orgId);
  return ent.features[feature];
}

export class FeatureGatedError extends Error {
  constructor(public readonly feature: keyof Entitlements['features']) {
    super(`Feature "${feature}" requires a higher plan.`);
    this.name = 'FeatureGatedError';
  }
}

export async function requireFeature(
  orgId: OrgId,
  feature: keyof Entitlements['features'],
): Promise<void> {
  if (!(await hasFeature(orgId, feature))) {
    throw new FeatureGatedError(feature);
  }
}
