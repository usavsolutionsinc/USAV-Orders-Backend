import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { db } from '@/lib/drizzle/db';
import { workflowTemplates } from '@/lib/drizzle/schema';
import { getNode, hasNode } from '@/lib/workflow';
import type { TemplateGraph } from '@/lib/studio/templates';
import type { StudioTemplateDetail } from '@/components/studio/studio-types';

/**
 * GET /api/studio/templates/[id]
 *
 * One system template's full graph (Studio ST6 / Phase E4), shaped like the
 * /api/studio/graph node/edge feed (each node enriched with the engine
 * registry's palette metadata) so the canvas could preview a template before a
 * tenant imports it. Read-only, studio.view — the template table is global
 * (no organization_id), so there is no tenant predicate.
 */
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  async (request) => {
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    // .../api/studio/templates/[id] → id is the last segment
    const templateId = Number(segments[segments.length - 1]);
    if (!Number.isFinite(templateId) || templateId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid template id' }, { status: 400 });
    }

    try {
      const rows = await db
        .select({
          id: workflowTemplates.id,
          slug: workflowTemplates.slug,
          name: workflowTemplates.name,
          description: workflowTemplates.description,
          category: workflowTemplates.category,
          graph: workflowTemplates.graph,
        })
        .from(workflowTemplates)
        .where(eq(workflowTemplates.id, templateId))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return NextResponse.json({ ok: false, error: 'template not found' }, { status: 404 });
      }

      const graph = (row.graph ?? { nodes: [], edges: [] }) as TemplateGraph;
      const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []).map((n) => {
        const meta = hasNode(n.type)
          ? (({ label, icon, category, outputs }) => ({ label, icon, category, outputs }))(getNode(n.type))
          : null;
        return {
          id: n.id,
          type: n.type,
          x: Number(n.x),
          y: Number(n.y),
          config: (n.config ?? {}) as Record<string, unknown>,
          meta,
        };
      });
      const edges = (Array.isArray(graph.edges) ? graph.edges : []).map((e) => ({
        id: e.id,
        source: e.source,
        sourcePort: e.sourcePort,
        target: e.target,
      }));

      const template: StudioTemplateDetail = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        category: row.category,
        nodes,
        edges,
      };

      return NextResponse.json({ ok: true, template });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'studio template detail failed';
      console.error('[GET /api/studio/templates/[id]] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'studio.view', feature: 'studio' },
);
