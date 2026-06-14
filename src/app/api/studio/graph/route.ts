import { NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { db } from '@/lib/drizzle/db';
import {
  stationDefinitions,
  workflowDefinitions,
  workflowEdges,
  workflowNodes,
} from '@/lib/drizzle/schema';
import { getNode, hasNode, listNodeMeta } from '@/lib/workflow';
import { runDiagnostics } from '@/lib/workflow/diagnostics';
import { summarizeStations } from '@/lib/studio/station-diagnostics';
import { STATIONS } from '@/components/admin/workflow/operations-catalog';

/**
 * GET /api/studio/graph?v=<definitionId>
 *
 * The Operations Studio canvas feed: one workflow definition (the org's
 * active one by default, or ?v= for a specific version) with its nodes and
 * edges, each node enriched with the engine registry's palette metadata
 * (label / icon / category / output ports via listNodeMeta-style lookup).
 * Also returns the org's definition list so the Studio's version switcher
 * can populate without a second request.
 *
 * Read-only — ST1 of the Studio plan. Editing (draft/publish) lives in
 * /api/studio/definitions/* behind studio.manage.
 */
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  async (request, ctx) => {
    const vRaw = request.nextUrl.searchParams.get('v');
    const v = vRaw ? Number(vRaw) : null;
    if (v !== null && (!Number.isFinite(v) || v <= 0)) {
      return NextResponse.json({ ok: false, error: 'invalid v' }, { status: 400 });
    }

    try {
      const definitions = await db
        .select({
          id: workflowDefinitions.id,
          name: workflowDefinitions.name,
          version: workflowDefinitions.version,
          isActive: workflowDefinitions.isActive,
        })
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.organizationId, ctx.organizationId))
        .orderBy(asc(workflowDefinitions.name), desc(workflowDefinitions.version));

      const definition = v
        ? definitions.find((d) => d.id === v) ?? null
        : definitions.find((d) => d.isActive) ?? definitions[0] ?? null;

      if (!definition) {
        return NextResponse.json({ ok: true, definitions, definition: null, nodes: [], edges: [] });
      }

      const [nodeRows, edgeRows] = await Promise.all([
        db
          .select()
          .from(workflowNodes)
          .where(eq(workflowNodes.workflowDefinitionId, definition.id)),
        db
          .select()
          .from(workflowEdges)
          .where(eq(workflowEdges.workflowDefinitionId, definition.id)),
      ]);

      const nodes = nodeRows.map((n) => {
        const meta = hasNode(n.type)
          ? (({ label, icon, category, outputs }) => ({ label, icon, category, outputs }))(
              getNode(n.type),
            )
          : null;
        return {
          id: n.id,
          type: n.type,
          x: Number(n.positionX),
          y: Number(n.positionY),
          config: (n.config ?? {}) as Record<string, unknown>,
          meta,
        };
      });

      const edges = edgeRows.map((e) => ({
        id: e.id,
        source: e.sourceNode,
        sourcePort: e.sourcePort,
        target: e.targetNode,
      }));

      // Full registered node-type palette (Library pane) — registry-driven,
      // so new node types appear without touching the Studio UI.
      const palette = listNodeMeta();

      // Station composition bound to these nodes — feeds the composition rules
      // (unmapped required role / dangling action) in the diagnostics linter.
      const nodeIds = nodeRows.map((n) => n.id);
      const stationRows = nodeIds.length
        ? await db
            .select({
              workflowNodeId: stationDefinitions.workflowNodeId,
              label: stationDefinitions.label,
              config: stationDefinitions.config,
            })
            .from(stationDefinitions)
            .where(
              and(
                eq(stationDefinitions.organizationId, ctx.organizationId),
                eq(stationDefinitions.isActive, true),
                inArray(stationDefinitions.workflowNodeId, nodeIds),
              ),
            )
        : [];

      // Lint the loaded graph (ST3): the Issues rail + Gaps lens render
      // these; ST4's publish gate will block on the error-severity ones.
      const diagnostics = runDiagnostics({
        nodes: nodeRows.map((n) => ({
          id: n.id,
          type: n.type,
          config: (n.config ?? {}) as Record<string, unknown>,
        })),
        edges,
        portsOf: (type) => (hasNode(type) ? getNode(type).outputs.map((o) => o.id) : null),
        stationKeys: new Set(STATIONS.map((s) => s.key)),
        labelOf: (n) => (hasNode(n.type) ? getNode(n.type).label : n.type),
        stationsByNode: summarizeStations(stationRows),
      });

      return NextResponse.json({ ok: true, definitions, definition, nodes, edges, palette, diagnostics });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'studio graph failed';
      console.error('[GET /api/studio/graph] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'studio.view' },
);
