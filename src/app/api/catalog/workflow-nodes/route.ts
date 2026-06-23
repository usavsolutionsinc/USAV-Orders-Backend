import { NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantDrizzle } from '@/lib/drizzle/tenant-db';
import { workflowDefinitions, workflowNodes } from '@/lib/drizzle/schema';
import { getNode, hasNode } from '@/lib/workflow';

/**
 * GET /api/catalog/workflow-nodes
 *
 * Flat list of the org's workflow-graph nodes, each enriched with the engine
 * registry's human label. Feeds the catalog type editor's "drive a custom flow"
 * picker (Phase 5) — binding a `types.workflow_node_id` to a node so that flow
 * routes items through a custom node-graph (the "own repair-service flow").
 *
 * Read-only; grouped by the definition the node lives in so the picker can show
 * "<definition> · <node label>". Same registry-driven enrichment as
 * /api/studio/graph so new node types appear without touching this route.
 */
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  async (_req, ctx) => {
    const orgId = ctx.organizationId;
    try {
      return await withTenantDrizzle(orgId, async (tx) => {
        const definitions = await tx
          .select({
            id: workflowDefinitions.id,
            name: workflowDefinitions.name,
            version: workflowDefinitions.version,
            isActive: workflowDefinitions.isActive,
          })
          .from(workflowDefinitions)
          .where(eq(workflowDefinitions.organizationId, orgId))
          .orderBy(desc(workflowDefinitions.isActive), asc(workflowDefinitions.name), desc(workflowDefinitions.version));

        if (definitions.length === 0) {
          return NextResponse.json({ success: true, nodes: [] });
        }

        const byDef = new Map(definitions.map((d) => [d.id, d]));
        // Re-gate the node read to the owning org: only nodes whose definition
        // belongs to this org are visible (defense in depth alongside the GUC,
        // since workflow_nodes is org-scoped transitively via its definition).
        const nodeRows = await tx
          .select({
            id: workflowNodes.id,
            type: workflowNodes.type,
            workflowDefinitionId: workflowNodes.workflowDefinitionId,
          })
          .from(workflowNodes)
          .where(
            and(
              eq(workflowNodes.workflowDefinitionId, definitions[0]!.id),
              inArray(
                workflowNodes.workflowDefinitionId,
                tx
                  .select({ id: workflowDefinitions.id })
                  .from(workflowDefinitions)
                  .where(eq(workflowDefinitions.organizationId, orgId)),
              ),
            ),
          );

        // Only the active (or first) definition's nodes are bindable — binding to
        // a stale version's canvas id would dangle when that version is replaced.
        const nodes = nodeRows.map((n) => {
          const def = byDef.get(n.workflowDefinitionId);
          const label = hasNode(n.type) ? getNode(n.type).label : n.type;
          return {
            id: n.id,
            type: n.type,
            label,
            definitionId: n.workflowDefinitionId,
            definitionName: def?.name ?? null,
          };
        });

        return NextResponse.json({ success: true, nodes });
      });
    } catch (error: any) {
      console.error('Error in GET /api/catalog/workflow-nodes:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to list workflow nodes' },
        { status: 500 },
      );
    }
  },
  { permission: 'receiving.view' },
);
