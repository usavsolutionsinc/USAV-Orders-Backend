import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { errorResponse } from '@/lib/api/errors';
import { parseBody } from '@/lib/schemas/parse';
import { StudioTemplateImportBody } from '@/lib/schemas/studio';
import { createDraftFromTemplate } from '@/lib/studio/templates';
import { buildTemplateSurfaceSeeds, seedTemplateSurfaces } from '@/lib/studio/template-surfaces';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/studio/templates/[id]/import
 *
 * Clones a system-owned workflow_templates blueprint into the CALLER's org as a
 * new is_active = FALSE draft workflow_definition (+ nodes + edges) — Studio ST6
 * / Phase E4. Node ids are re-minted (global TEXT PKs); edges remapped through
 * the same map; every cloned row org-stamped (the definition explicitly, the
 * node/edge children via the org-verified workflow_definition_id fk). The owner
 * then edits + publishes it via the existing draft/publish flow.
 *
 * studio.manage (importing creates a draft — same gate as draft creation). The
 * whole clone runs inside withTenantTransaction so it writes ONLY to the
 * caller's org; the template table itself is global and never written here.
 * Returns the new definition id so the client can switch to it (?v=<newId>).
 */
export const dynamic = 'force-dynamic';

export const POST = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  // .../api/studio/templates/[id]/import → id is segments[-2]
  const templateId = Number(segments[segments.length - 2]);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid template id' }, { status: 400 });
  }

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    /* empty body = import under the template's own name */
  }
  const parsed = parseBody(StudioTemplateImportBody, raw ?? {});
  if (parsed instanceof NextResponse) return parsed;

  try {
    const { outcome, surfacesSeeded } = await withTenantTransaction(ctx.organizationId, async (client) => {
      const result = await createDraftFromTemplate({
        client,
        orgId: ctx.organizationId,
        staffId: ctx.staffId,
        templateId,
        name: parsed.name,
      });

      // Templates seed their associated UI surfaces too (Phase 5): read the new
      // draft's nodes (already re-minted global ids) and seed a node-bound,
      // draft ('legacy'-config) station_definition for each surface those node
      // types imply — same tx, so it's atomic with the graph import.
      let seeded = 0;
      if (result.status === 200) {
        const { rows } = await client.query<{ id: string; type: string }>(
          `SELECT id, type FROM workflow_nodes WHERE workflow_definition_id = $1`,
          [result.body.id],
        );
        const nodes = rows.map((n) => ({ id: n.id, type: n.type, x: 0, y: 0 }));
        const identityMap = new Map(nodes.map((n) => [n.id, n.id]));
        const seeds = buildTemplateSurfaceSeeds(nodes, identityMap);
        seeded = await seedTemplateSurfaces(client, ctx.organizationId, ctx.staffId, seeds);
      }
      return { outcome: result, surfacesSeeded: seeded };
    });

    if (outcome.status === 200 && 'audit' in outcome) {
      await recordAudit(pool, ctx, request, {
        source: 'studio.template.import',
        action: AUDIT_ACTION.WORKFLOW_TEMPLATE_IMPORT,
        entityType: AUDIT_ENTITY.WORKFLOW_DEFINITION,
        entityId: outcome.audit.draftId,
        method: 'manual',
        extra: {
          templateId: outcome.audit.templateId,
          templateSlug: outcome.audit.templateSlug,
          name: outcome.audit.name,
          version: outcome.audit.version,
          nodes: outcome.audit.nodes,
          edges: outcome.audit.edges,
          surfacesSeeded,
        },
      });
    }

    return NextResponse.json(
      outcome.status === 200 ? { ...outcome.body, surfacesSeeded } : outcome.body,
      { status: outcome.status },
    );
  } catch (err) {
    console.error('[POST /api/studio/templates/[id]/import] error:', err);
    return errorResponse(err, 'studio.template.import');
  }
}, { permission: 'studio.manage', feature: 'studio' });
