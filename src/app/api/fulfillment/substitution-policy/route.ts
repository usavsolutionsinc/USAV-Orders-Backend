import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getSubstitutionEnforcement, getSubstitutionAllowedNodes } from '@/lib/tenancy/settings';
import { isFulfillmentSubstitution } from '@/lib/feature-flags';
import type { OrgId } from '@/lib/tenancy/constants';
import type { SubstitutionPolicy } from '@/lib/tech/substitution-eligibility';

/**
 * GET /api/fulfillment/substitution-policy — the org's fulfillment-substitution
 * policy, read by the tech/packing station surfaces so they can gate the
 * SubstituteUnitCard mount without prop-drilling org settings (mirrors
 * GET /api/packing/policy). Gated on tech.view — every tech-station operator
 * already holds it; packers reading this hold it via broader roles or get
 * `canSubstitute` from their own surface's policy read.
 *
 * `canSubstitute` folds the three server-side gates the client would otherwise
 * have to probe separately: the FULFILLMENT_SUBSTITUTION env flag, the org's
 * substitutionAllowedNodes containing 'test' (this endpoint serves the tech
 * bench), and the caller holding tech.substitute_unit OR packing.substitute_unit
 * (the same OR the POST /api/orders/[id]/substitute route enforces).
 */
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const enabled = isFulfillmentSubstitution();
  const org = await getOrganization(ctx.organizationId as OrgId);
  const enforcement = org ? getSubstitutionEnforcement(org.settings) : 'advisory';
  const allowedNodes: SubstitutionPolicy['allowedNodes'] = org
    ? getSubstitutionAllowedNodes(org.settings)
    : ['pick'];
  const hasPermission =
    ctx.permissions.has('tech.substitute_unit') || ctx.permissions.has('packing.substitute_unit');
  const canSubstitute = enabled && allowedNodes.includes('test') && hasPermission;

  const policy: SubstitutionPolicy = {
    enabled,
    enforcement,
    allowedNodes: [...allowedNodes],
    canSubstitute,
  };
  return NextResponse.json(policy);
}, { permission: 'tech.view' });
