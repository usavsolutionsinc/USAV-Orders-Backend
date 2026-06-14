/**
 * Workflow engine — advance one item.
 *
 * The durable step that moves a serial unit from its current node to the next.
 * Pipeline:
 *
 *   lock → load state → run current node → record run → emit →
 *     await?  → park (blocked/error)
 *     else    → resolve next edge → moveTo(next)  OR  mark done (terminal)
 *
 * All collaborators are injected (WorkflowStore, registry getNode, emit, lock)
 * so this is unit-testable with in-memory fakes — see advance.test.ts. The real
 * wiring is composed in store.ts + index.ts.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import type {
  AdvanceLock,
  NodeContext,
  NodeDefinition,
  WorkflowEvent,
  WorkflowStore,
} from './contract';
import { NULL_LOCK } from './contract';
import { runNode, ERROR_OUTPUT } from './runtime';

export interface AdvanceDeps {
  store: WorkflowStore;
  getNode: (type: string) => NodeDefinition;
  emit: (event: WorkflowEvent) => Promise<void>;
  /** Defaults to a no-op lock; pass a real Upstash lock in production (Phase D). */
  lock?: AdvanceLock;
}

export interface AdvanceArgs {
  orgId: OrgId;
  serialUnitId: number;
  actor: NodeContext['actor'];
  input?: Record<string, unknown>;
}

export type AdvanceOutcome =
  | { status: 'moved'; from: string; to: string; output: string; nodeType: string }
  | { status: 'done'; output: string; nodeType: string }
  | { status: 'blocked'; output: string; nodeType: string }
  | { status: 'error'; output: string; nodeType: string; error: string }
  | { status: 'noop'; reason: 'not_enrolled' | 'locked' | 'already_terminal' | 'broken_graph' };

const lockKey = (serialUnitId: number) => `wf:advance:${serialUnitId}`;

export async function advanceItem(
  deps: AdvanceDeps,
  args: AdvanceArgs,
): Promise<AdvanceOutcome> {
  const lock = deps.lock ?? NULL_LOCK;
  const key = lockKey(args.serialUnitId);

  if (!(await lock.acquire(key))) {
    return { status: 'noop', reason: 'locked' };
  }

  try {
    const state = await deps.store.loadState(args.serialUnitId);
    if (!state) return { status: 'noop', reason: 'not_enrolled' };
    if (state.status === 'done') return { status: 'noop', reason: 'already_terminal' };

    const node = await deps.store.loadNode(state.workflowDefinitionId, state.currentNodeId);
    if (!node) return { status: 'noop', reason: 'broken_graph' };

    const ctx: NodeContext = {
      orgId: args.orgId,
      serialUnitId: args.serialUnitId,
      actor: args.actor,
      config: node.config,
      input: args.input ?? {},
      context: state.context,
      emit: deps.emit,
    };

    // run() never throws here — runtime maps thrown errors to the `error` port.
    const def = resolveDef(deps, node.type);
    if (!def) {
      const message = `Unknown node type: ${node.type}`;
      await deps.store.recordRun({
        serialUnitId: args.serialUnitId,
        workflowDefinitionId: state.workflowDefinitionId,
        nodeType: node.type,
        output: ERROR_OUTPUT,
        durationMs: 0,
        error: message,
      });
      await deps.store.setStatus(state, 'error', { error: message });
      await safeEmit(deps, errEvent(state, node.type, state.currentNodeId));
      return { status: 'error', output: ERROR_OUTPUT, nodeType: node.type, error: message };
    }

    const { result, run } = await runNode(def, ctx, state.workflowDefinitionId);
    await deps.store.recordRun(run);
    const patch = result.data ?? {};

    await safeEmit(deps, {
      serialUnitId: args.serialUnitId,
      workflowDefinitionId: state.workflowDefinitionId,
      nodeType: node.type,
      output: result.output,
      at: nowIso(),
      nodeId: state.currentNodeId,
    });

    // Error output: park the item in an error state for triage.
    if (result.output === ERROR_OUTPUT) {
      await deps.store.setStatus(state, 'error', patch);
      return {
        status: 'error',
        output: result.output,
        nodeType: node.type,
        error: String(patch.error ?? 'node error'),
      };
    }

    // Explicit await: park the item, waiting on a human/event. No routing.
    if (result.await) {
      await deps.store.setStatus(state, 'blocked', patch);
      return { status: 'blocked', output: result.output, nodeType: node.type };
    }

    const next = await deps.store.resolveNext(
      state.workflowDefinitionId,
      state.currentNodeId,
      result.output,
    );

    if (!next) {
      // No edge for this port → terminal node, the item is done.
      await deps.store.setStatus(state, 'done', patch);
      return { status: 'done', output: result.output, nodeType: node.type };
    }

    await deps.store.moveTo(state, next, patch);
    return {
      status: 'moved',
      from: state.currentNodeId,
      to: next,
      output: result.output,
      nodeType: node.type,
    };
  } finally {
    await lock.release(key);
  }
}

function resolveDef(deps: AdvanceDeps, type: string): NodeDefinition | null {
  try {
    return deps.getNode(type);
  } catch {
    return null;
  }
}

async function safeEmit(deps: AdvanceDeps, event: WorkflowEvent): Promise<void> {
  try {
    await deps.emit(event);
  } catch {
    // Realtime is best-effort; never fail an advance because Ably hiccupped.
  }
}

function errEvent(
  state: { serialUnitId: number; workflowDefinitionId: number },
  nodeType: string,
  nodeId: string,
): WorkflowEvent {
  return {
    serialUnitId: state.serialUnitId,
    workflowDefinitionId: state.workflowDefinitionId,
    nodeType,
    output: ERROR_OUTPUT,
    at: nowIso(),
    nodeId,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}
