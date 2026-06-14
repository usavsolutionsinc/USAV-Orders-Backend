import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { errorResponse } from '@/lib/api/errors';
import { parseBody } from '@/lib/schemas/parse';
import { StudioDraftCreateBody } from '@/lib/schemas/studio';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/studio/definitions/draft
 *
 * Creates a DRAFT workflow definition by copying a source definition
 * (default: the org's active one) into the next version number for that
 * name, is_active = FALSE. Node ids are re-minted (they are global TEXT
 * PKs); edges are remapped accordingly. All Studio editing targets a draft —
 * the active version is never mutated in place (Studio law #6).
 */
export const dynamic = 'force-dynamic';

export const POST = withAuth(async (request, ctx) => {
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    /* empty body = copy the active definition */
  }
  const parsed = parseBody(StudioDraftCreateBody, raw ?? {});
  if (parsed instanceof NextResponse) return parsed;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const source = await client.query<{ id: number; name: string }>(
      parsed.sourceId
        ? `SELECT id, name FROM workflow_definitions
            WHERE organization_id = $1 AND id = $2 FOR UPDATE`
        : `SELECT id, name FROM workflow_definitions
            WHERE organization_id = $1 AND is_active = TRUE
            ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      parsed.sourceId ? [ctx.organizationId, parsed.sourceId] : [ctx.organizationId],
    );
    if (!source.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ ok: false, error: 'source definition not found' }, { status: 404 });
    }
    const src = source.rows[0];

    // Lock the whole (org, name) version group so two concurrent draft
    // creations can't both read the same MAX(version) and collide on the
    // unique (org, name, version) index.
    await client.query(
      `SELECT id FROM workflow_definitions
        WHERE organization_id = $1 AND name = $2 FOR UPDATE`,
      [ctx.organizationId, src.name],
    );

    const draft = await client.query<{ id: number; version: number }>(
      `INSERT INTO workflow_definitions (organization_id, name, version, is_active, created_by)
       SELECT organization_id, name,
              (SELECT MAX(version) + 1 FROM workflow_definitions
                WHERE organization_id = $1 AND name = $2),
              FALSE, $3
         FROM workflow_definitions WHERE id = $4
       RETURNING id, version`,
      [ctx.organizationId, src.name, ctx.staffId, src.id],
    );
    const draftId = draft.rows[0].id;

    // Copy nodes with fresh global ids; remap edges through the same map.
    const nodes = await client.query<{ id: string; type: string; position_x: string; position_y: string; config: unknown }>(
      `SELECT id, type, position_x, position_y, config FROM workflow_nodes WHERE workflow_definition_id = $1`,
      [src.id],
    );
    const idMap = new Map<string, string>(nodes.rows.map((n) => [n.id, `n-${randomUUID()}`]));
    for (const n of nodes.rows) {
      await client.query(
        `INSERT INTO workflow_nodes (id, workflow_definition_id, type, position_x, position_y, config)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [idMap.get(n.id), draftId, n.type, n.position_x, n.position_y, n.config],
      );
    }
    const edges = await client.query<{ source_node: string; source_port: string; target_node: string }>(
      `SELECT source_node, source_port, target_node FROM workflow_edges WHERE workflow_definition_id = $1`,
      [src.id],
    );
    for (const e of edges.rows) {
      await client.query(
        `INSERT INTO workflow_edges (id, workflow_definition_id, source_node, source_port, target_node)
         VALUES ($1, $2, $3, $4, $5)`,
        [`e-${randomUUID()}`, draftId, idMap.get(e.source_node), e.source_port, idMap.get(e.target_node)],
      );
    }

    await client.query('COMMIT');

    await recordAudit(pool, ctx, request, {
      source: 'studio.draft',
      action: AUDIT_ACTION.WORKFLOW_DRAFT_CREATE,
      entityType: AUDIT_ENTITY.WORKFLOW_DEFINITION,
      entityId: draftId,
      method: 'manual',
      extra: { sourceId: src.id, name: src.name, version: draft.rows[0].version },
    });

    return NextResponse.json({ ok: true, id: draftId, version: draft.rows[0].version });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /api/studio/definitions/draft] error:', err);
    return errorResponse(err, 'studio.draft.create');
  } finally {
    client.release();
  }
}, { permission: 'studio.manage' });
