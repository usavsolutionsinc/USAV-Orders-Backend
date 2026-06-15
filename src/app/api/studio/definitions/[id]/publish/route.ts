import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { errorResponse } from '@/lib/api/errors';
import { getNode, hasNode } from '@/lib/workflow';
import { runDiagnostics } from '@/lib/workflow/diagnostics';
import { summarizeStations } from '@/lib/studio/station-diagnostics';
import { STATIONS } from '@/components/admin/workflow/operations-catalog';
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
        return { status: 200 as const, body: { ok: true, alreadyActive: true, id: definitionId } };
      }

      // Blocking diagnostics gate — inside the transaction so the rows we
      // lint are exactly the rows that go live. workflow_nodes / workflow_edges
      // have no org column; the org-verified definitionId is their tenant scope.
      const nodes = await client.query<{ id: string; type: string; config: Record<string, unknown> }>(
        `SELECT id, type, config FROM workflow_nodes WHERE workflow_definition_id = $1`,
        [definitionId],
      );
      const edges = await client.query<{ id: string; source_node: string; source_port: string; target_node: string }>(
        `SELECT id, source_node, source_port, target_node FROM workflow_edges WHERE workflow_definition_id = $1`,
        [definitionId],
      );
      // Station composition bound to the draft's nodes — feeds the composition
      // rules so an unmapped required role / dangling action blocks publish too.
      const stationRows = nodes.rows.length
        ? (
            await client.query<{ workflow_node_id: string | null; label: string; config: Record<string, unknown> }>(
              `SELECT workflow_node_id, label, config FROM station_definitions
                WHERE organization_id = $1 AND is_active = TRUE AND workflow_node_id = ANY($2)`,
              [ctx.organizationId, nodes.rows.map((n) => n.id)],
            )
          ).rows
        : [];
      const diagnostics = runDiagnostics({
        nodes: nodes.rows.map((n) => ({ id: n.id, type: n.type, config: n.config ?? {} })),
        edges: edges.rows.map((e) => ({
          id: e.id,
          source: e.source_node,
          sourcePort: e.source_port,
          target: e.target_node,
        })),
        portsOf: (type) => (hasNode(type) ? getNode(type).outputs.map((o) => o.id) : null),
        stationKeys: new Set(STATIONS.map((s) => s.key)),
        labelOf: (n) => (hasNode(n.type) ? getNode(n.type).label : n.type),
        stationsByNode: summarizeStations(
          stationRows.map((r) => ({ workflowNodeId: r.workflow_node_id, label: r.label, config: r.config })),
        ),
      });
      const blocking = diagnostics.filter((d) => d.severity === 'error');
      if (blocking.length > 0) {
        return {
          status: 422 as const,
          body: { ok: false, error: 'PUBLISH_BLOCKED', diagnostics: blocking },
        };
      }
      if (nodes.rows.length === 0) {
        return { status: 422 as const, body: { ok: false, error: 'cannot publish an empty graph' } };
      }

      // Deactivate + activate in ONE statement (the stations-publish CTE
      // pattern): two concurrent publishes of different drafts of the same
      // name can't interleave a two-statement flip and leave both active.
      await client.query(
        `WITH deactivated AS (
           UPDATE workflow_definitions
              SET is_active = FALSE, updated_at = NOW()
            WHERE organization_id = $1 AND name = $2 AND is_active = TRUE AND id <> $3
            RETURNING id
         )
         UPDATE workflow_definitions
            SET is_active = TRUE, updated_at = NOW()
          WHERE id = $3 AND organization_id = $1`,
        [ctx.organizationId, def.rows[0].name, definitionId],
      );

      return {
        status: 200 as const,
        body: { ok: true, id: definitionId, version: def.rows[0].version },
        audit: {
          name: def.rows[0].name,
          version: def.rows[0].version,
          nodes: nodes.rows.length,
          edges: edges.rows.length,
          warnings: diagnostics.filter((d) => d.severity === 'warning').length,
        },
      };
    });

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
}, { permission: 'studio.manage', stepUp: true });
