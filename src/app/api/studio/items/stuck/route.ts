import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantDrizzle } from '@/lib/drizzle/tenant-db';
import {
  itemWorkflowState,
  serialUnits,
  workflowDefinitions,
  workflowNodes,
} from '@/lib/drizzle/schema';

/**
 * GET /api/studio/items/stuck?v=<definitionId>&status=blocked|error|all
 *
 * The recovery/triage feed: the individual blocked|error items the Live lens
 * only counts in aggregate. Each row carries enough to triage + recover: the
 * unit identity, its domain status, where it's parked, and the last error
 * captured on the position context. Scoped to the org's active definition by
 * default (or ?v). One point-read; the client refetches on the engine's Ably
 * db-events, never on a poll (Studio law #4).
 */
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  async (request, ctx) => {
    const params = request.nextUrl.searchParams;
    const vRaw = params.get('v');
    const v = vRaw ? Number(vRaw) : null;
    if (vRaw && (!Number.isFinite(v) || (v ?? 0) <= 0)) {
      return NextResponse.json({ ok: false, error: 'invalid v' }, { status: 400 });
    }
    const statusParam = (params.get('status') || 'all').toLowerCase();
    const statuses =
      statusParam === 'blocked' ? ['blocked'] : statusParam === 'error' ? ['error'] : ['blocked', 'error'];

    try {
      // GUC-scoped (RLS-ready): item_workflow_state is FORCE-slated, so the
      // org-verification read and the triage list both run on a GUC-bearing
      // tenant connection. The org predicate stays explicit (defense in depth).
      const items = await withTenantDrizzle(ctx.organizationId, async (tx) => {
        const [definition] = await tx
          .select({ id: workflowDefinitions.id })
          .from(workflowDefinitions)
          .where(
            and(
              eq(workflowDefinitions.organizationId, ctx.organizationId),
              v ? eq(workflowDefinitions.id, v) : eq(workflowDefinitions.isActive, true),
            ),
          )
          .limit(1);

        if (!definition) return [];

        return tx
          .select({
            serialUnitId: itemWorkflowState.serialUnitId,
            status: itemWorkflowState.status,
            nodeId: itemWorkflowState.currentNodeId,
            enteredNodeAt: itemWorkflowState.enteredNodeAt,
            lastError: sql<string | null>`${itemWorkflowState.context} ->> 'error'`,
            nodeType: workflowNodes.type,
            serialNumber: serialUnits.serialNumber,
            sku: serialUnits.sku,
            currentStatus: sql<string>`${serialUnits.currentStatus}::text`,
          })
          .from(itemWorkflowState)
          .leftJoin(
            workflowNodes,
            and(
              eq(workflowNodes.workflowDefinitionId, itemWorkflowState.workflowDefinitionId),
              eq(workflowNodes.id, itemWorkflowState.currentNodeId),
            ),
          )
          .leftJoin(serialUnits, eq(serialUnits.id, itemWorkflowState.serialUnitId))
          .where(
            and(
              eq(itemWorkflowState.organizationId, ctx.organizationId),
              eq(itemWorkflowState.workflowDefinitionId, definition.id),
              inArray(itemWorkflowState.status, statuses),
            ),
          )
          .orderBy(desc(itemWorkflowState.updatedAt))
          .limit(200);
      });

      return NextResponse.json({ ok: true, items });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'studio stuck-items failed';
      console.error('[GET /api/studio/items/stuck] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'studio.view', feature: 'studio' },
);
