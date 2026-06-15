import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { errorResponse } from '@/lib/api/errors';
import { recordAudit, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * DELETE /api/studio/definitions/[id]/discard
 *
 * Permanently remove a never-published workflow definition draft (the reverse
 * of the draft INSERT). Cascades to its workflow_nodes / workflow_edges (ON
 * DELETE CASCADE). REFUSES to discard:
 *   - the active version (publish a new version to retire it instead), and
 *   - any definition still referenced by in-flight items (item_workflow_state),
 *     which has no cascade and would be orphaned.
 * Returns 404 for an unknown/already-discarded id.
 */
export const dynamic = 'force-dynamic';

export const DELETE = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  // .../api/studio/definitions/[id]/discard → id is segments[-2]
  const definitionId = Number(segments[segments.length - 2]);
  if (!Number.isFinite(definitionId) || definitionId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid definition id' }, { status: 400 });
  }

  try {
    const outcome = await withTenantTransaction(ctx.organizationId, async (client) => {
      const def = await client.query<{ id: number; name: string; version: number; is_active: boolean }>(
        `SELECT id, name, version, is_active FROM workflow_definitions
          WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.organizationId, definitionId],
      );
      if (!def.rows[0]) {
        return { status: 404 as const, body: { ok: false, error: 'definition not found' } };
      }
      if (def.rows[0].is_active) {
        return {
          status: 409 as const,
          body: { ok: false, error: 'cannot discard the active version — publish a new version to retire it' },
        };
      }

      // item_workflow_state carries organization_id — scope the in-flight check.
      const inflight = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM item_workflow_state
          WHERE workflow_definition_id = $1 AND organization_id = $2`,
        [definitionId, ctx.organizationId],
      );
      if (Number(inflight.rows[0]?.n ?? 0) > 0) {
        return {
          status: 409 as const,
          body: { ok: false, error: 'cannot discard: in-flight items still reference this definition' },
        };
      }

      // Cascades to workflow_nodes / workflow_edges (ON DELETE CASCADE) — those
      // child tables have no org column; they are scoped via this parent delete.
      await client.query(
        `DELETE FROM workflow_definitions WHERE id = $1 AND organization_id = $2`,
        [definitionId, ctx.organizationId],
      );

      return {
        status: 200 as const,
        body: { ok: true, id: definitionId },
        audit: { name: def.rows[0].name, version: def.rows[0].version },
      };
    });

    if (outcome.status === 200 && 'audit' in outcome) {
      await recordAudit(pool, ctx, request, {
        source: 'studio.discard',
        action: 'workflow.discard',
        entityType: AUDIT_ENTITY.WORKFLOW_DEFINITION,
        entityId: definitionId,
        method: 'manual',
        before: { name: outcome.audit.name, version: outcome.audit.version },
        after: null,
      });
    }

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error('[DELETE /api/studio/definitions/[id]/discard] error:', err);
    return errorResponse(err, 'studio.discard');
  }
}, { permission: 'studio.manage' });
