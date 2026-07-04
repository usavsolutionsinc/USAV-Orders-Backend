/**
 * Template catalog → apply-to-org (universal-feed plan Phase 5, "template-first
 * onboarding"). Generalizes the first-seed clone into a reusable lib fn: seed a
 * chosen (or the default) system workflow_template into an org.
 *
 * Two callers, two postures:
 *   - Onboarding first-seed (seedDefaultWorkflowForOrg): default template,
 *     activate=true, skipIfExists=true — the org boots with a live graph.
 *   - Pick-a-vertical (programmatic): an explicit templateId, activate=false —
 *     lands a DRAFT the owner reviews + publishes via the existing human gate
 *     (the HTTP equivalent is POST /api/studio/templates/[id]/import).
 *
 * Owns its withTenantTransaction boundary so callers invoke it best-effort (a
 * seed failure must never block org creation). Deps-injected so it unit-tests
 * DB-free.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { createDraftFromTemplate } from './templates';

interface TxClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface ApplyTemplateToOrgArgs {
  orgId: OrgId;
  staffId: number | null;
  /** Explicit template; omitted → the blessed default system template. */
  templateId?: number;
  /** Set the cloned definition active. Onboarding first-seed only (a fresh name group). */
  activate?: boolean;
  /** No-op if the org already has ANY workflow definition (idempotent onboarding). */
  skipIfExists?: boolean;
}

export interface ApplyTemplateToOrgResult {
  status: 200 | 404 | 409 | 500;
  seeded: boolean;
  definitionId: number | null;
  activated: boolean;
  reason?: string;
}

export interface ApplyTemplateDeps {
  runTransaction: <T>(orgId: OrgId, fn: (client: TxClient) => Promise<T>) => Promise<T>;
  createDraft: typeof createDraftFromTemplate;
}

const defaultDeps: ApplyTemplateDeps = {
  runTransaction: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client)),
  createDraft: createDraftFromTemplate,
};

export async function applyTemplateToOrg(
  args: ApplyTemplateToOrgArgs,
  deps: ApplyTemplateDeps = defaultDeps,
): Promise<ApplyTemplateToOrgResult> {
  const { orgId, staffId, templateId, activate = false, skipIfExists = false } = args;

  return deps.runTransaction(orgId, async (client) => {
    if (skipIfExists) {
      const already = await client.query(
        `SELECT 1 FROM workflow_definitions WHERE organization_id = $1 LIMIT 1`,
        [orgId],
      );
      if (already.rows[0]) {
        return { status: 200, seeded: false, definitionId: null, activated: false, reason: 'org already has a definition' };
      }
    }

    // Resolve the template: explicit id, else the blessed default (is_default),
    // else the first system row (pre-2026-06-28m DBs). Global table, no org predicate.
    let tid = templateId;
    if (tid == null) {
      const tpl = await client.query(
        `SELECT id FROM workflow_templates WHERE is_system = true ORDER BY is_default DESC, id LIMIT 1`,
      );
      if (!tpl.rows[0]) return { status: 404, seeded: false, definitionId: null, activated: false, reason: 'no system template seeded' };
      tid = Number(tpl.rows[0].id);
    }

    const result = await deps.createDraft({ client: client as never, orgId, staffId: staffId as never, templateId: tid });
    if (result.status !== 200) {
      const reason = 'body' in result && result.body.ok === false ? result.body.error : 'clone failed';
      return { status: result.status, seeded: false, definitionId: null, activated: false, reason };
    }
    const definitionId = result.body.id;

    let activated = false;
    if (activate) {
      // The clone lands under the template's own NAME group, is_active = FALSE.
      // Activating a fresh name group is safe (the invariant is one active per
      // (org, name)); the onboarding first-seed is the org's only definition.
      await client.query(
        `UPDATE workflow_definitions SET is_active = TRUE WHERE id = $1 AND organization_id = $2`,
        [definitionId, orgId],
      );
      activated = true;
    }

    return { status: 200, seeded: true, definitionId, activated };
  });
}
