import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { errorResponse } from '@/lib/api/errors';
import { parseBody } from '@/lib/schemas/parse';
import { StudioGraphSaveBody } from '@/lib/schemas/studio';
import { hasNode } from '@/lib/workflow';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * PUT /api/studio/definitions/[id]/graph
 *
 * Replaces a DRAFT definition's nodes + edges in one transaction (the
 * canvas's "Save draft"). Drafts only — the active version is never mutated
 * in place (Studio law #6); publishing a new version is the only way changes
 * go live. A draft may contain gaps (those are diagnostics, gating publish,
 * not saves) but node types must exist in the engine registry and the
 * payload must be internally consistent (schema-enforced).
 *
 * Naturally idempotent: the body is the full desired graph.
 */
export const dynamic = 'force-dynamic';

export const PUT = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  // .../api/studio/definitions/[id]/graph → id is segments[-2]
  const definitionId = Number(segments[segments.length - 2]);
  if (!Number.isFinite(definitionId) || definitionId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid definition id' }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = parseBody(StudioGraphSaveBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const unknownTypes = [...new Set(parsed.nodes.map((n) => n.type))].filter((t) => !hasNode(t));
  if (unknownTypes.length > 0) {
    return NextResponse.json(
      { ok: false, error: `unknown node type(s): ${unknownTypes.join(', ')}` },
      { status: 422 },
    );
  }

  try {
    const outcome = await withTenantTransaction(ctx.organizationId, async (client) => {
      const def = await client.query<{ id: number; is_active: boolean; version: number }>(
        `SELECT id, is_active, version FROM workflow_definitions
          WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.organizationId, definitionId],
      );
      if (!def.rows[0]) {
        return { status: 404 as const, body: { ok: false, error: 'definition not found' } };
      }
      if (def.rows[0].is_active) {
        return {
          status: 409 as const,
          body: { ok: false, error: 'the active version is read-only — edit a draft and publish it' },
        };
      }

      // workflow_edges / workflow_nodes have no org column — the parent
      // workflow_definition_id (just org-verified above) is their tenant scope.
      await client.query(`DELETE FROM workflow_edges WHERE workflow_definition_id = $1`, [definitionId]);
      await client.query(`DELETE FROM workflow_nodes WHERE workflow_definition_id = $1`, [definitionId]);
      for (const n of parsed.nodes) {
        await client.query(
          `INSERT INTO workflow_nodes (id, workflow_definition_id, type, position_x, position_y, config)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [n.id, definitionId, n.type, n.x, n.y, JSON.stringify(n.config ?? {})],
        );
      }
      for (const e of parsed.edges) {
        await client.query(
          `INSERT INTO workflow_edges (id, workflow_definition_id, source_node, source_port, target_node)
           VALUES ($1, $2, $3, $4, $5)`,
          [e.id, definitionId, e.source, e.sourcePort, e.target],
        );
      }
      await client.query(
        `UPDATE workflow_definitions SET updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [definitionId, ctx.organizationId],
      );

      return {
        status: 200 as const,
        body: { ok: true, id: definitionId, nodes: parsed.nodes.length, edges: parsed.edges.length },
        audit: { version: def.rows[0].version },
      };
    });

    if (outcome.status === 200 && 'audit' in outcome) {
      await recordAudit(pool, ctx, request, {
        source: 'studio.draft',
        action: AUDIT_ACTION.WORKFLOW_DRAFT_SAVE,
        entityType: AUDIT_ENTITY.WORKFLOW_DEFINITION,
        entityId: definitionId,
        method: 'manual',
        extra: { nodes: parsed.nodes.length, edges: parsed.edges.length, version: outcome.audit.version },
      });
    }

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error('[PUT /api/studio/definitions/[id]/graph] error:', err);
    return errorResponse(err, 'studio.draft.save');
  }
}, { permission: 'studio.manage' });
