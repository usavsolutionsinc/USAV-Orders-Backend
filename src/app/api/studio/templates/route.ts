import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { db } from '@/lib/drizzle/db';
import { workflowTemplates } from '@/lib/drizzle/schema';
import type { TemplateGraph } from '@/lib/studio/templates';
import type { StudioTemplateSummary } from '@/components/studio/studio-types';

/**
 * GET /api/studio/templates
 *
 * The Operations Studio template library (Studio ST6 / Phase E4): system-owned
 * DEFAULT workflow graphs a tenant can clone into its own definitions. These
 * rows are GLOBAL (no organization_id) — they hold no tenant data, so the list
 * is the same for every org. studio.view gates it (importing is studio.manage).
 *
 * Node/edge counts are derived from the stored graph so the Library card can
 * show the shape without shipping the full graph (use the [id] detail for that).
 */
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  async () => {
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
        .where(eq(workflowTemplates.isSystem, true))
        .orderBy(asc(workflowTemplates.name));

      const templates: StudioTemplateSummary[] = rows.map((r) => {
        const graph = (r.graph ?? { nodes: [], edges: [] }) as TemplateGraph;
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          category: r.category,
          nodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
          edgeCount: Array.isArray(graph.edges) ? graph.edges.length : 0,
        };
      });

      return NextResponse.json({ ok: true, templates });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'studio templates failed';
      console.error('[GET /api/studio/templates] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'studio.view', feature: 'studio' },
);
