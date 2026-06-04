/**
 * Workflow engine — node runtime.
 *
 * Runs a single node: times it, catches failures, and returns a normalized
 * outcome plus the RunRecord for the observability log. Persistence and routing
 * are the caller's job (advance.ts) — this stays a pure function of the node +
 * context so it's easy to test.
 *
 * A node that throws is not a crash: it resolves to the reserved `error` output
 * port so a workflow can route failures explicitly (an edge from `error` → a
 * triage node), and the error text is captured on the run record.
 */

import type { NodeDefinition, NodeContext, NodeResult, RunRecord } from './contract';

export const ERROR_OUTPUT = 'error';

export interface RunOutcome {
  result: NodeResult;
  run: RunRecord;
}

export async function runNode(
  def: NodeDefinition,
  ctx: NodeContext,
  workflowDefinitionId: number | null,
): Promise<RunOutcome> {
  const startedAt = Date.now();
  try {
    const result = await def.run(ctx);
    return {
      result,
      run: {
        serialUnitId: ctx.serialUnitId,
        workflowDefinitionId,
        nodeType: def.type,
        output: result.output,
        durationMs: Date.now() - startedAt,
        error: null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      result: { output: ERROR_OUTPUT, data: { error: message }, await: true },
      run: {
        serialUnitId: ctx.serialUnitId,
        workflowDefinitionId,
        nodeType: def.type,
        output: ERROR_OUTPUT,
        durationMs: Date.now() - startedAt,
        error: message,
      },
    };
  }
}
