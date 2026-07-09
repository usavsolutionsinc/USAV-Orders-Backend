/**
 * Workflow engine — Drizzle-backed store.
 *
 * The production WorkflowStore. The two ENGINE tables it owns —
 * `item_workflow_state` and `workflow_runs` — are tenant-scoped and slated for
 * RLS FORCE (Phase E), so every statement that touches them runs inside
 * `withTenantDrizzle(orgId, …)`: a GUC-bearing connection (`SET LOCAL
 * app.current_org`) on the tenant pool. organizationId is ALSO passed
 * explicitly on every read/write (defense in depth — RLS is a backstop, not a
 * substitute for a correct predicate).
 *
 * `loadNode` / `resolveNext` deliberately stay on the stateless neon-http `db`:
 * `workflow_nodes` / `workflow_edges` carry NO organization_id (they are scoped
 * via their parent workflow_definitions row), so they are never RLS-org-FORCED
 * and need no GUC — keeping them on neon-http avoids an extra pooled connection
 * per advance.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/drizzle/db';
import { withTenantDrizzle } from '@/lib/drizzle/tenant-db';
import {
  itemWorkflowState,
  workflowNodes,
  workflowEdges,
  workflowRuns,
} from '@/lib/drizzle/schema';
import type { OrgId } from '@/lib/tenancy/constants';
import type { ItemState, NodeRecord, RunRecord, WorkflowStore } from './contract';

export function createDrizzleStore(orgId: OrgId): WorkflowStore {
  return {
    async loadState(serialUnitId): Promise<ItemState | null> {
      // GUC-scoped read (RLS-ready). The org predicate stays explicit — defense
      // in depth — so a cross-org id reads as not-enrolled rather than leaking
      // another tenant's position.
      const [row] = await withTenantDrizzle(orgId, (tx) =>
        tx
          .select()
          .from(itemWorkflowState)
          .where(
            and(
              eq(itemWorkflowState.organizationId, orgId),
              eq(itemWorkflowState.serialUnitId, serialUnitId),
            ),
          )
          .limit(1),
      );
      if (!row) return null;
      return {
        serialUnitId: row.serialUnitId,
        workflowDefinitionId: row.workflowDefinitionId,
        currentNodeId: row.currentNodeId,
        status: row.status as ItemState['status'],
        context: (row.context ?? {}) as Record<string, unknown>,
      };
    },

    async loadNode(workflowDefinitionId, nodeId): Promise<NodeRecord | null> {
      const [row] = await db
        .select({ type: workflowNodes.type, config: workflowNodes.config })
        .from(workflowNodes)
        .where(
          and(
            eq(workflowNodes.workflowDefinitionId, workflowDefinitionId),
            eq(workflowNodes.id, nodeId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return { type: row.type, config: (row.config ?? {}) as Record<string, unknown> };
    },

    // workflow_nodes / workflow_edges have no organization_id (parent-scoped),
    // so loadNode + resolveNext stay on neon-http `db` — no GUC needed.
    async resolveNext(workflowDefinitionId, sourceNode, sourcePort): Promise<string | null> {
      const [row] = await db
        .select({ target: workflowEdges.targetNode })
        .from(workflowEdges)
        .where(
          and(
            eq(workflowEdges.workflowDefinitionId, workflowDefinitionId),
            eq(workflowEdges.sourceNode, sourceNode),
            eq(workflowEdges.sourcePort, sourcePort),
          ),
        )
        .limit(1);
      return row ? row.target : null;
    },

    async moveTo(state, nextNodeId, contextPatch): Promise<void> {
      const now = new Date();
      await withTenantDrizzle(orgId, (tx) =>
        tx
          .update(itemWorkflowState)
          .set({
            currentNodeId: nextNodeId,
            status: 'active',
            context: { ...state.context, ...contextPatch },
            enteredNodeAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(itemWorkflowState.organizationId, orgId),
              eq(itemWorkflowState.serialUnitId, state.serialUnitId),
            ),
          ),
      );
    },

    async setStatus(state, status, contextPatch): Promise<void> {
      await withTenantDrizzle(orgId, (tx) =>
        tx
          .update(itemWorkflowState)
          .set({
            status,
            context: contextPatch ? { ...state.context, ...contextPatch } : state.context,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(itemWorkflowState.organizationId, orgId),
              eq(itemWorkflowState.serialUnitId, state.serialUnitId),
            ),
          ),
      );
    },

    async recordRun(run: RunRecord): Promise<void> {
      await withTenantDrizzle(orgId, (tx) =>
        tx.insert(workflowRuns).values({
          organizationId: orgId,
          serialUnitId: run.serialUnitId,
          workflowDefinitionId: run.workflowDefinitionId ?? undefined,
          nodeType: run.nodeType,
          output: run.output ?? undefined,
          durationMs: run.durationMs ?? undefined,
          error: run.error ?? undefined,
        }),
      );
    },
  };
}

/**
 * Enroll a serial unit into a workflow at a starting node (idempotent on the
 * unit — the unique index ux_item_workflow_state_unit means one active row per
 * unit). Used by triggers/backfill in later phases.
 */
export async function enrollItem(args: {
  orgId: OrgId;
  serialUnitId: number;
  workflowDefinitionId: number;
  startNodeId: string;
}): Promise<void> {
  const now = new Date();
  // GUC-scoped write (RLS-ready) — item_workflow_state is FORCE-slated.
  await withTenantDrizzle(args.orgId, (tx) =>
    tx
      .insert(itemWorkflowState)
      .values({
        organizationId: args.orgId,
        serialUnitId: args.serialUnitId,
        workflowDefinitionId: args.workflowDefinitionId,
        currentNodeId: args.startNodeId,
        status: 'active',
        context: {},
        enteredNodeAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: itemWorkflowState.serialUnitId,
        set: {
          workflowDefinitionId: args.workflowDefinitionId,
          currentNodeId: args.startNodeId,
          status: 'active',
          context: {},
          enteredNodeAt: now,
          updatedAt: now,
        },
      }),
  );
}
