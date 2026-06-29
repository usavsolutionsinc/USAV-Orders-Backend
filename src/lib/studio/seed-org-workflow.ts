/**
 * seed-org-workflow — Phase F4-lite onboarding.
 *
 * A brand-new org has no `workflow_definition`, so the node-graph engine has
 * nothing to route intake through (a "blank" tenant). This clones the default
 * SYSTEM workflow template into the org and marks it active, so receiving/test/
 * list flows work out-of-the-box. The owner can edit + re-publish later in Studio.
 *
 * Owns its own `withTenantTransaction(orgId, …)` boundary (unlike templates.ts,
 * which is client-injected) so callers — signup / createOrganization — invoke it
 * best-effort: a seed failure must never block org creation.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { createDraftFromTemplate } from './templates';

export async function seedDefaultWorkflowForOrg(orgId: OrgId, staffId: number): Promise<void> {
  await withTenantTransaction(orgId, async (client) => {
    // Idempotent: never double-seed an org that already has a definition.
    const already = await client.query(
      `SELECT 1 FROM workflow_definitions WHERE organization_id = $1 LIMIT 1`,
      [orgId],
    );
    if (already.rows[0]) return;

    // The default blueprint: the system template flagged is_default (today the
    // "electronics-av-refurb" flagship), falling back to the first system row if
    // none is flagged (pre-2026-06-28m DBs). Global table, no org predicate by design.
    const tpl = await client.query<{ id: number }>(
      `SELECT id FROM workflow_templates WHERE is_system = true ORDER BY is_default DESC, id LIMIT 1`,
    );
    if (!tpl.rows[0]) return; // no system template seeded in this DB

    const result = await createDraftFromTemplate({
      client,
      orgId,
      staffId,
      templateId: tpl.rows[0].id,
    });
    if (result.status !== 200) return;

    // Activate the freshly-cloned definition (the org's first + only one, so no
    // other active version to deactivate; a system-blessed template needs no
    // diagnostics gate for the initial seed).
    await client.query(
      `UPDATE workflow_definitions SET is_active = TRUE
        WHERE id = $1 AND organization_id = $2`,
      [result.body.id, orgId],
    );
  });
}
