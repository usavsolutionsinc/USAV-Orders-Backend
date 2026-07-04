/**
 * Assistant tool registry + runner (plan §3.1/§3.2).
 *
 * One export the agent loop consumes; MCP can later expose the same entries
 * (name/description/zod-input → JSON schema) over a second transport with no
 * rework. `runAssistantTool` is the single execution chokepoint: unknown-tool
 * → permission → Zod-validate → run, with the org ALWAYS taken from the
 * authenticated ctx (never from model input).
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { AssistantToolCtx, AssistantToolDef, AssistantToolDeps, AssistantToolRunResult } from './types';
import {
  getBenchmarks,
  getChatHistory,
  getFeedState,
  getGraph,
  getKpis,
  getMutationHistory,
  getNodeDetail,
  getSignalsByNode,
  getTopReasons,
  getUnitJourney,
  searchNotes,
} from './read-tools';

const READ_TOOLS: ReadonlyArray<AssistantToolDef<any, unknown>> = [
  getSignalsByNode,
  getTopReasons,
  getUnitJourney,
  getFeedState,
  getGraph,
  getNodeDetail,
  getBenchmarks,
  getKpis,
  searchNotes,
  getMutationHistory,
  getChatHistory,
];

export const ASSISTANT_TOOLS: ReadonlyMap<string, AssistantToolDef<any, unknown>> = new Map(
  READ_TOOLS.map((t) => [t.name, t]),
);

export function listAssistantTools(ctx?: Pick<AssistantToolCtx, 'permissions'>) {
  return READ_TOOLS.filter((t) => !ctx || ctx.permissions.has(t.permission)).map((t) => ({
    name: t.name,
    description: t.description,
    permission: t.permission,
    inputSchema: t.inputSchema,
  }));
}

const defaultDeps: AssistantToolDeps = {
  query: async (orgId, text, params) => {
    const r = await tenantQuery(orgId, text, params);
    return { rows: r.rows as Array<Record<string, unknown>> };
  },
};

export async function runAssistantTool(
  name: string,
  rawInput: unknown,
  ctx: AssistantToolCtx,
  deps: AssistantToolDeps = defaultDeps,
): Promise<AssistantToolRunResult> {
  const tool = ASSISTANT_TOOLS.get(name);
  if (!tool) return { ok: false, code: 'unknown_tool', error: `Unknown tool "${name}"` };
  if (!ctx.permissions.has(tool.permission)) {
    return { ok: false, code: 'forbidden', error: `Missing permission ${tool.permission} for ${name}` };
  }
  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', error: `Invalid input for ${name}: ${parsed.error.message}` };
  }
  try {
    const data = await tool.run(parsed.data, ctx, deps);
    return { ok: true, data };
  } catch (err) {
    // Graceful tool-error surfacing: the agent loop shows the model a clean
    // failure it can route around, never a thrown 500.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, code: 'tool_error', error: `${name} failed: ${message}` };
  }
}

