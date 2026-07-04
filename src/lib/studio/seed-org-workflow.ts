/**
 * seed-org-workflow — Phase F4-lite onboarding.
 *
 * A brand-new org has no `workflow_definition`, so the node-graph engine has
 * nothing to route intake through (a "blank" tenant). This clones the default
 * SYSTEM workflow template into the org and marks it active, so receiving/test/
 * list flows work out-of-the-box. The owner can edit + re-publish later in Studio.
 *
 * Thin wrapper over `applyTemplateToOrg` (template-catalog) with the onboarding
 * posture: default template, activate, skip-if-exists. Best-effort — a seed
 * failure must never block org creation (the caller swallows). The live seam is
 * the signup route; a tenant wanting a DIFFERENT vertical uses the import route
 * / applyTemplateToOrg with an explicit templateId (a draft, published via the
 * human gate).
 */

import type { OrgId } from '@/lib/tenancy/constants';
import { applyTemplateToOrg } from './template-catalog';

export async function seedDefaultWorkflowForOrg(orgId: OrgId, staffId: number): Promise<void> {
  await applyTemplateToOrg({ orgId, staffId, activate: true, skipIfExists: true });
}
