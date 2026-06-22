import { NextResponse } from 'next/server';
import { and, eq, ne, sql } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { db } from '@/lib/drizzle/db';
import { itemWorkflowState, workflowDefinitions } from '@/lib/drizzle/schema';

/**
 * GET /api/studio/live?v=<definitionId>
 *
 * The Live lens feed: per-node in-flight occupancy for one workflow
 * definition — active/blocked/error counts and the oldest entry timestamp
 * (the aging signal compared against the node's slaHours). One grouped
 * point-read per call; the client refreshes it on the engine's Ably
 * db-events (db:public:item_workflow_state), NEVER on a poll interval —
 * Studio law #4 (Neon CU cost).
 */
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  async (request, ctx) => {
    const vRaw = request.nextUrl.searchParams.get('v');
    const v = vRaw ? Number(vRaw) : null;
    if (vRaw && (!Number.isFinite(v) || (v ?? 0) <= 0)) {
      return NextResponse.json({ ok: false, error: 'invalid v' }, { status: 400 });
    }

    try {
      // Resolve the definition org-scoped (default: the active one).
      const [definition] = await db
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.organizationId, ctx.organizationId),
            v ? eq(workflowDefinitions.id, v) : eq(workflowDefinitions.isActive, true),
          ),
        )
        .limit(1);

      if (!definition) {
        return NextResponse.json({ ok: true, nodes: {}, totalInFlight: 0 });
      }

      const rows = await db
        .select({
          nodeId: itemWorkflowState.currentNodeId,
          active: sql<number>`count(*) filter (where ${itemWorkflowState.status} = 'active')::int`,
          blocked: sql<number>`count(*) filter (where ${itemWorkflowState.status} = 'blocked')::int`,
          error: sql<number>`count(*) filter (where ${itemWorkflowState.status} = 'error')::int`,
          oldestEnteredAt: sql<string | null>`min(${itemWorkflowState.enteredNodeAt}) filter (where ${itemWorkflowState.status} in ('active', 'blocked'))`,
        })
        .from(itemWorkflowState)
        .where(
          and(
            eq(itemWorkflowState.workflowDefinitionId, definition.id),
            ne(itemWorkflowState.status, 'done'),
          ),
        )
        .groupBy(itemWorkflowState.currentNodeId);

      const nodes: Record<
        string,
        { active: number; blocked: number; error: number; total: number; oldestEnteredAt: string | null }
      > = {};
      let totalInFlight = 0;
      for (const r of rows) {
        const total = r.active + r.blocked;
        nodes[r.nodeId] = {
          active: r.active,
          blocked: r.blocked,
          error: r.error,
          total,
          oldestEnteredAt: r.oldestEnteredAt,
        };
        totalInFlight += total;
      }

      return NextResponse.json({ ok: true, nodes, totalInFlight });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'studio live failed';
      console.error('[GET /api/studio/live] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'studio.view', feature: 'studio' },
);
