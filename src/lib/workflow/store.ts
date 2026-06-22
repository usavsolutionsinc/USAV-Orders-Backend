/**
 * Workflow engine — Drizzle-backed store.
 *
 * The production WorkflowStore. Every write passes organizationId EXPLICITLY:
 * the app uses the neon-http Drizzle client, which runs each statement as an
 * isolated HTTP request and therefore can't see the `app.current_org` session
 * GUC that orgIdCol() defaults from. Relying on the default here would insert
 * NULL into a NOT NULL column.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/drizzle/db';
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
      const [row] = await db
        .select()
        .from(itemWorkflowState)
        // Org-scoped read: neon-http can't see the GUC, so the predicate is
        // explicit (mirrors recordRun's explicit stamp). A cross-org id reads
        // as not-enrolled rather than leaking another tenant's position.
        .where(
          and(
            eq(itemWorkflowState.organizationId, orgId),
            eq(itemWorkflowState.serialUnitId, serialUnitId),
          ),
        )
        .limit(1);
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
      await db
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
        );
    },

    async setStatus(state, status, contextPatch): Promise<void> {
      await db
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
        );
    },

    async recordRun(run: RunRecord): Promise<void> {
      await db.insert(workflowRuns).values({
        organizationId: orgId,
        serialUnitId: run.serialUnitId,
        workflowDefinitionId: run.workflowDefinitionId ?? undefined,
        nodeType: run.nodeType,
        output: run.output ?? undefined,
        durationMs: run.durationMs ?? undefined,
        error: run.error ?? undefined,
      });
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
  await db
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
    });
}
