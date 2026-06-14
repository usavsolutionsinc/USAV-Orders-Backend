/**
 * Workflow engine — core contract.
 *
 * These are the types every part of the node engine shares. The design goal is
 * that a "node" never re-implements business logic: each NodeDefinition.run is a
 * thin adapter over an existing src/lib/* module (receiving, tech, shipping…),
 * and the engine only decides ROUTING based on which output port fired.
 *
 * See docs/operations-studio/NODE_WORKFLOW_ARCHITECTURE.md §3 and
 * docs/operations-studio/NODE_WORKFLOW_IMPLEMENTATION_PLAN.md (Phase B).
 */

import type { OrgId } from '@/lib/tenancy/constants';

// ─── Node execution ──────────────────────────────────────────

/** Everything a node can read/use while it runs. */
export interface NodeContext {
  orgId: OrgId;
  serialUnitId: number;
  /** Who/what triggered this advance. */
  actor: { staffId: number | null; source: 'scan' | 'manual' | 'webhook' | 'cron' };
  /** Per-node config the operator set on the canvas (thresholds, mappings…). */
  config: Record<string, unknown>;
  /** Free-form payload from the trigger (scanned barcode, webhook body…). */
  input: Record<string, unknown>;
  /** Accumulated outputs from upstream nodes in this item's run. */
  context: Record<string, unknown>;
  /** Emit a realtime/domain event. Injected so nodes stay testable. */
  emit: (event: WorkflowEvent) => Promise<void>;
}

export interface NodeResult {
  /** Named output port that fired — this is what drives conditional routing. */
  output: string;
  /** Data merged into the item's run context for downstream nodes. */
  data?: Record<string, unknown>;
  /** If true, the item parks at this node awaiting a human/event (no auto-advance). */
  await?: boolean;
}

export interface NodeDefinition {
  /** Registry key, e.g. 'inspection'. Stored on workflow_nodes.type. */
  type: string;
  /** Label shown on the canvas. */
  label: string;
  /** lucide icon name (the canvas resolves it). */
  icon: string;
  category: 'intake' | 'process' | 'fulfill' | 'logic' | 'custom';
  /** Declared output ports — the canvas draws one source handle per port. */
  outputs: NodeOutputPort[];
  /** Optional config form schema the canvas renders. */
  configSchema?: Record<string, unknown>;
  /** The actual work. Should delegate to an existing domain module. */
  run(ctx: NodeContext): Promise<NodeResult>;
}

export interface NodeOutputPort {
  id: string;
  label: string;
}

/** Palette-facing metadata (no `run`) — what /api/workflow/nodes returns. */
export type NodeMeta = Omit<NodeDefinition, 'run'>;

export interface WorkflowEvent {
  serialUnitId: number;
  workflowDefinitionId: number | null;
  nodeType: string;
  /** Output port that fired, or a lifecycle marker like 'entered' | 'done' | 'error'. */
  output: string;
  at: string;
  /**
   * Source node INSTANCE id that fired (not the registry type). Optional, but
   * when present it lets the Studio's Live lens animate the exact traversed
   * edge `(nodeId, output)` rather than guessing from `nodeType`.
   */
  nodeId?: string;
}

// ─── Persistence boundary ────────────────────────────────────
//
// The engine talks to storage through this interface only, so advanceItem() can
// be unit-tested with an in-memory fake. The real Drizzle implementation lives
// in store.ts and passes organizationId explicitly on every write (the
// neon-http client can't see the app.current_org GUC that orgIdCol() defaults
// from).

export interface ItemState {
  serialUnitId: number;
  workflowDefinitionId: number;
  currentNodeId: string;
  status: 'active' | 'blocked' | 'done' | 'error';
  context: Record<string, unknown>;
}

export interface RunRecord {
  serialUnitId: number;
  workflowDefinitionId: number | null;
  nodeType: string;
  output: string | null;
  durationMs: number | null;
  error: string | null;
}

/** A node's persisted shape (type + operator config), resolved from its id. */
export interface NodeRecord {
  type: string;
  config: Record<string, unknown>;
}

export interface WorkflowStore {
  /** Current position of a unit, or null if it isn't enrolled in a workflow. */
  loadState(serialUnitId: number): Promise<ItemState | null>;
  /** Resolve a node id to its registry type + config, or null if missing. */
  loadNode(workflowDefinitionId: number, nodeId: string): Promise<NodeRecord | null>;
  /** Edge lookup: the target node for (sourceNode, sourcePort), or null. */
  resolveNext(
    workflowDefinitionId: number,
    sourceNode: string,
    sourcePort: string,
  ): Promise<string | null>;
  /** Move the unit to a new node, merging context. */
  moveTo(
    state: ItemState,
    nextNodeId: string,
    contextPatch: Record<string, unknown>,
  ): Promise<void>;
  /** Terminal/parked/error transitions. */
  setStatus(
    state: ItemState,
    status: ItemState['status'],
    contextPatch?: Record<string, unknown>,
  ): Promise<void>;
  /** Append a run-log row (observability). */
  recordRun(run: RunRecord): Promise<void>;
}

/** Optional mutual-exclusion lock so two scans can't double-advance one unit. */
export interface AdvanceLock {
  acquire(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}

/** No-op lock — used until a real Upstash lock is wired in Phase D. */
export const NULL_LOCK: AdvanceLock = {
  async acquire() {
    return true;
  },
  async release() {
    /* no-op */
  },
};
