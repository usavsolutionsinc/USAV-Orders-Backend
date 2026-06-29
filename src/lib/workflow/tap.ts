/**
 * Workflow engine — production tap.
 *
 * The one entry point domain code calls AFTER a mutation commits to mirror it
 * into the operations graph. The engine is an OBSERVER here: the tapped
 * route/lib already did the work (created the unit, recorded the verdict,
 * completed the repair); the tap only tells the engine "this domain event
 * happened to this unit" and the current node translates it into an output
 * port (see nodes/station-node.ts).
 *
 * Two hard rules, both enforced in this file:
 *
 *  1. FIRE-AND-FORGET — an engine failure must never fail a production scan.
 *     tapWorkflow never throws; every error is logged with the [workflow-tap]
 *     prefix and dropped. Callers may `void tapWorkflow(...)` or await it.
 *
 *  2. IDEMPOTENT — a re-scan/retry advances a unit at most once. Enrollment
 *     only happens when the unit has no item_workflow_state row, and every
 *     node parks (`await: true`) unless ctx.input carries the domain event it
 *     is gated on — so replaying an event against a unit that already moved
 *     past that node just re-parks it where it is.
 *
 * Tenancy: enrollment needs an org to resolve the active workflow definition;
 * routes pass ctx.organizationId. Once enrolled, the org comes from the
 * unit's own item_workflow_state row, so lib-level taps (e.g. updateRepair)
 * can omit it.
 */

import { and, asc, desc, eq, notExists, sql } from 'drizzle-orm';
import { db } from '@/lib/drizzle/db';
import { withTenantDrizzle } from '@/lib/drizzle/tenant-db';
import {
  itemWorkflowState,
  workflowDefinitions,
  workflowEdges,
  workflowNodes,
} from '@/lib/drizzle/schema';
import type { NodeContext } from './contract';
import { advance } from './index';
import { enrollItem } from './store';

/** Domain events the built-in station nodes are gated on. */
export type WorkflowTapEvent =
  | 'unit_received'
  | 'test_verdict'
  // Fired by the data-wipe station action (recordDataWipe) after a secure
  // erase / factory reset. The `data_wipe` node maps wipeSuccess → 'wiped'
  // (→ grade) vs 'failed' (→ repair). Unlike most taps this advances ONLY the
  // graph position — the wipe is a recorded compliance event, not a
  // serial_units status change.
  | 'data_wiped'
  | 'repair_completed'
  | 'listed'
  | 'packed'
  // Fired when the packer confirms the box contents against the SKU's kit-parts
  // BOM (the kit_verify node). Like 'packed'/'shipped', the node exists ahead of
  // its tap — no domain site fires this yet; wiring is one tapWorkflow call at
  // the pack-confirm gate once the packer adopts a scan→confirm step.
  | 'pack_verified'
  | 'shipped';

export interface WorkflowTapArgs {
  serialUnitId: number;
  event: WorkflowTapEvent;
  /** Extra event payload merged into the node's ctx.input (e.g. { verdict }). */
  input?: Record<string, unknown>;
  staffId?: number | null;
  source?: NodeContext['actor']['source'];
  /**
   * Tenant id — required to ENROLL (only `unit_received` enrolls); ignored
   * for units that already have a workflow position.
   */
  orgId?: string | null;
  /**
   * Position guard (opt-in). When set, the tap only advances a unit whose
   * CURRENT graph node is of this registry type; off that node it is a no-op
   * (the unit is left where it is, not advanced). Without it, a later-stage
   * observer event fired against a unit parked at the wrong node runs that node,
   * fails to match, and parks it `blocked` (see advance.ts await→blocked) —
   * false "stuck" triage noise. Used by the fulfillment-tail taps: 'listed'
   * passes 'list_ebay', 'packed' passes 'pack', so a unit shipped without first
   * being listed-through-the-engine is left alone instead of blocked. Omit it
   * (the legacy taps do) to advance from wherever the unit sits.
   */
  expectNodeType?: string;
}

export async function tapWorkflow(args: WorkflowTapArgs): Promise<void> {
  try {
    // Deliberate pre-read even though advance() loads state again: this row
    // is the orgId source for lib-level taps that have no auth ctx (e.g.
    // updateRepair), and advance() must keep doing its own read so the state
    // is fresh once a real per-unit lock lands (acquire → read → write).
    // One indexed point-select per human-paced scan is the accepted cost.
    const state = await loadTapState(args.serialUnitId, args.orgId ?? null);

    let orgId = state?.organizationId ?? null;

    if (!state) {
      // Only the receiving event starts a run; later-stage events on an
      // unenrolled unit (legacy stock, pre-rollout units) are dropped.
      if (args.event !== 'unit_received' || !args.orgId) return;
      orgId = args.orgId;

      const start = await findEntryNode(orgId);
      if (!start) return; // no active workflow for this org — nothing to do
      await enrollItem({
        orgId,
        serialUnitId: args.serialUnitId,
        workflowDefinitionId: start.workflowDefinitionId,
        startNodeId: start.nodeId,
      });
    } else if (state.status === 'done') {
      return; // finished runs stay finished (returns re-enter via rma_intake later)
    }

    if (!orgId) return;

    // Position guard: only advance when the unit is parked at the node this
    // event is meant for. Off that node, no-op (don't run the wrong node and
    // park it `blocked`). Only enrolled units reach here, so `state` is set.
    if (args.expectNodeType && state && state.currentNodeType !== args.expectNodeType) {
      return;
    }

    await advance(orgId, {
      serialUnitId: args.serialUnitId,
      actor: { staffId: args.staffId ?? null, source: args.source ?? 'scan' },
      input: { event: args.event, ...(args.input ?? {}) },
    });
  } catch (err) {
    console.warn(
      `[workflow-tap] ${args.event} for unit ${args.serialUnitId} failed (non-fatal):`,
      err,
    );
  }
}

interface TapStateRow {
  organizationId: string;
  status: string;
  /** Current parked node's registry type — for the opt-in position guard. */
  currentNodeType: string | null;
}

/**
 * The org-discovery + position-guard pre-read against item_workflow_state.
 *
 * When the caller knows the org (every route tap + the applyTransition
 * chokepoint always pass it), the read is scoped through `withTenantDrizzle` so
 * it carries the `app.current_org` GUC and keeps working once
 * item_workflow_state is RLS-FORCED (Phase E); the org predicate is explicit
 * (defense in depth). When the caller does NOT know the org — legacy lib
 * re-taps that omit it (recordTestVerdict's pre-chokepoint path, updateRepair) —
 * it falls back to the stateless neon-http `db` to discover the owning org by
 * the globally-unique serial_unit_id. That fallback is an INTENTIONAL cross-org
 * lookup and is the one residual item_workflow_state read not behind the GUC;
 * it relies on the owner connection's RLS bypass and would need an org threaded
 * through those legacy callers before item_workflow_state can be FORCE-enforced.
 *
 * LEFT JOIN on workflow_nodes (no org column) so an enrolled unit parked on a
 * since-removed node still loads (currentNodeType null → guard treats it as a
 * mismatch no-op).
 */
async function loadTapState(
  serialUnitId: number,
  orgId: string | null,
): Promise<TapStateRow | undefined> {
  if (orgId) {
    const [row] = await withTenantDrizzle(orgId, (tx) =>
      tx
        .select({
          organizationId: itemWorkflowState.organizationId,
          status: itemWorkflowState.status,
          currentNodeType: workflowNodes.type,
        })
        .from(itemWorkflowState)
        .leftJoin(
          workflowNodes,
          and(
            eq(workflowNodes.id, itemWorkflowState.currentNodeId),
            eq(workflowNodes.workflowDefinitionId, itemWorkflowState.workflowDefinitionId),
          ),
        )
        .where(
          and(
            eq(itemWorkflowState.organizationId, orgId),
            eq(itemWorkflowState.serialUnitId, serialUnitId),
          ),
        )
        .limit(1),
    );
    return row;
  }

  const [row] = await db
    .select({
      organizationId: itemWorkflowState.organizationId,
      status: itemWorkflowState.status,
      currentNodeType: workflowNodes.type,
    })
    .from(itemWorkflowState)
    .leftJoin(
      workflowNodes,
      and(
        eq(workflowNodes.id, itemWorkflowState.currentNodeId),
        eq(workflowNodes.workflowDefinitionId, itemWorkflowState.workflowDefinitionId),
      ),
    )
    .where(eq(itemWorkflowState.serialUnitId, serialUnitId))
    .limit(1);
  return row;
}

/**
 * The org's active workflow definition + its entry node (the leftmost node
 * with no inbound edges — what the canvas draws first).
 *
 * Cached per org for a minute: enrollment bursts (a PO receive can create
 * several units back-to-back) would otherwise refire the same two queries,
 * and the active definition only changes on publish. Best-effort across
 * serverless instances — a stale hit just enrolls onto the about-to-be-
 * replaced version, which is exactly the documented publish semantics
 * (in-flight items finish on their old version).
 */
const ENTRY_CACHE_TTL_MS = 60_000;
const entryCache = new Map<
  string,
  { value: { workflowDefinitionId: number; nodeId: string } | null; at: number }
>();

async function findEntryNode(
  orgId: string,
): Promise<{ workflowDefinitionId: number; nodeId: string } | null> {
  const cached = entryCache.get(orgId);
  if (cached && Date.now() - cached.at < ENTRY_CACHE_TTL_MS) return cached.value;

  const value = await loadEntryNode(orgId);
  entryCache.set(orgId, { value, at: Date.now() });
  return value;
}

async function loadEntryNode(
  orgId: string,
): Promise<{ workflowDefinitionId: number; nodeId: string } | null> {
  const [def] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.organizationId, orgId),
        eq(workflowDefinitions.isActive, true),
      ),
    )
    .orderBy(desc(workflowDefinitions.version))
    .limit(1);
  if (!def) return null;

  const [entry] = await db
    .select({ id: workflowNodes.id })
    .from(workflowNodes)
    .where(
      and(
        eq(workflowNodes.workflowDefinitionId, def.id),
        notExists(
          db
            .select({ one: sql`1` })
            .from(workflowEdges)
            .where(
              and(
                eq(workflowEdges.workflowDefinitionId, def.id),
                eq(workflowEdges.targetNode, workflowNodes.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(workflowNodes.positionX))
    .limit(1);
  if (!entry) return null;

  return { workflowDefinitionId: def.id, nodeId: entry.id };
}
