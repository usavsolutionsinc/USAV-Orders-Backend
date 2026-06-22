import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { errorResponse } from '@/lib/api/errors';
// Side-effect import: registers the built-in node types into the engine registry
// (publishDefinition's diagnostics gate looks them up via getNode/hasNode).
import '@/lib/workflow';
import { publishDefinition } from '@/lib/studio/definitions';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/studio/definitions/[id]/publish
 *
 * Atomically activates a draft workflow definition (Studio law #6):
 * one transaction — run BLOCKING diagnostics (any error-severity finding
 * refuses with 422 + the findings), deactivate the name's currently-active
 * version, flip the draft to is_active, record the actor. In-flight items
 * keep their workflow_definition_id, so they finish on the old version.
 *
 * Step-up enforced (Studio law #7): publishing changes how the whole floor
 * routes work, so a fresh PIN/passkey grant is required (admins bypass,
 * matching the house step-up semantics in withAuth).
 *
 * Idempotent: publishing the already-active version returns success.
 */
export const dynamic = 'force-dynamic';

export const POST = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  // .../api/studio/definitions/[id]/publish → id is segments[-2]
  const definitionId = Number(segments[segments.length - 2]);
  if (!Number.isFinite(definitionId) || definitionId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid definition id' }, { status: 400 });
  }

  try {
    const outcome = await withTenantTransaction(ctx.organizationId, (client) =>
      publishDefinition({ client, orgId: ctx.organizationId, definitionId }),
    );

    const audit = 'audit' in outcome ? outcome.audit : undefined;
    if (audit) {
      await recordAudit(pool, ctx, request, {
        source: 'studio.publish',
        action: AUDIT_ACTION.WORKFLOW_PUBLISH,
        entityType: AUDIT_ENTITY.WORKFLOW_DEFINITION,
        entityId: definitionId,
        method: 'manual',
        extra: {
          name: audit.name,
          version: audit.version,
          nodes: audit.nodes,
          edges: audit.edges,
          warnings: audit.warnings,
        },
      });
    }

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error('[POST /api/studio/definitions/[id]/publish] error:', err);
    return errorResponse(err, 'studio.publish');
  }
}, { permission: 'studio.manage', stepUp: true, feature: 'studio' });
