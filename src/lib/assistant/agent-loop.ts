/**
 * Server agent loop (plan §3.2) — the Claude tool-use loop behind
 * POST /api/assistant/chat.
 *
 * Read/explain only in Phase 2: the model composes the org-scoped read-tool
 * registry (src/lib/assistant/tools) plus a CLIENT UI tool namespace
 * (navigate/highlight + Phase 3 canvas stubs). Server tools execute here; UI
 * tool calls are forwarded to the browser through the `emit` sink and
 * acknowledged to the model immediately (standard client-tool pattern).
 *
 * Invariants:
 *   • org/staff/permissions come from the authenticated ctx — NEVER from the
 *     model or the request body;
 *   • hard iteration cap (MAX_TURNS) — a runaway loop degrades to a polite
 *     "ran out of steps", never an unbounded bill;
 *   • tool failures surface to the model as is_error tool_results it can
 *     route around — they never throw out of the loop;
 *   • prompt-cache discipline: stable system core first (cache_control), the
 *     volatile page-context fragment after the breakpoint.
 *
 * Deps-injected (default = real Anthropic SDK + real tool registry) so unit
 * tests run with zero network and zero DB.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { listAssistantTools, runAssistantTool } from '@/lib/assistant/tools';
import type { AssistantToolCtx, AssistantToolDef, AssistantToolRunResult } from '@/lib/assistant/tools/types';
import type { AssistantPageContext } from './context-store';

const ASSISTANT_MODEL = 'claude-opus-4-8';
const MAX_TURNS = 8;
const MAX_TOKENS = 16000;

// ─── UI tools (client-executed) ──────────────────────────────────────────────
// navigate/highlight are live in Phase 2; the canvas-control namespace ships
// as stubs the dock ignores until Phase 3 wires the Studio URL state.

export const UI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'navigate',
    description:
      'Navigate the user\'s browser to an app route. Every surface is URL-addressable — e.g. /operations?mode=analytics, /receiving?mode=history&openReceivingId=123, /studio?focus=<nodeId>. Use after you have gathered what you need and the user asked to go somewhere or you want to show them the data in place.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute app path starting with /' },
        params: {
          type: 'object',
          description: 'Query params to append, e.g. {"mode":"analytics"}',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'highlight',
    description:
      'Visually highlight an entity on the current page by canonical ref (e.g. "serial_units:entity:9041" or "feed_memberships:feed_key:receiving_triage:entity:123"). Use to point the user at a specific row/card you are talking about.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Canonical ref of the entity to highlight' } },
      required: ['ref'],
    },
  },
  // Canvas-control tools — drive the /studio URL view state in the user's
  // browser (they navigate to /studio if the user isn't there).
  {
    name: 'focus_node',
    description: 'Focus a node on the /studio canvas so the user sees it (drives ?focus= and zooms to the flow level). Use when discussing or editing a specific node.',
    input_schema: {
      type: 'object',
      properties: { nodeId: { type: 'string' } },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_lens',
    description: 'Switch the /studio overlay lens: build (structure), live (occupancy), flow (throughput), people (coverage), gaps (diagnostics), static (flow projection).',
    input_schema: {
      type: 'object',
      properties: { lens: { type: 'string', enum: ['build', 'live', 'flow', 'people', 'gaps', 'static'] } },
      required: ['lens'],
    },
  },
  {
    name: 'set_zoom',
    description: 'Set the /studio semantic-zoom depth: 0 department map, 1 flow graph, 2 station detail.',
    input_schema: {
      type: 'object',
      properties: { z: { type: 'integer', enum: [0, 1, 2] } },
      required: ['z'],
    },
  },
];

const UI_TOOL_NAMES = new Set(UI_TOOLS.map((t) => t.name));

// ─── System prompt ───────────────────────────────────────────────────────────

/** Stable core — byte-identical across requests so the prompt cache holds. */
export function buildSystemCore(toolNames: string[]): string {
  return [
    'You are the operations assistant embedded in a used-electronics reseller operations platform (receiving, testing, repair, listing, fulfillment, returns).',
    'You answer questions about THIS organization\'s live operation using your read tools — never from memory. Compose tools per question: aggregate first (get_top_reasons, get_kpis, get_signals_by_node), then drill down (get_unit_journey, search_notes, get_node_detail).',
    'When the answer depends on operational data not already in the conversation, you MUST call a read tool before answering.',
    'If you have the propose_mutation tool you can make changes. The trust model is automatic — you never decide whether a change is applied: view-layer changes (dismiss a rail item, set a feed item state, record a signal, tune a node surface) apply immediately; workflow DRAFT edits (add/remove/wire/config a node in a draft graph) apply to a draft the user can preview and revert; changes to masters (create staff, add a reason code, change a setting) are queued for review. ALWAYS set the user\'s expectation from the returned status: "applied to your draft", "done", or "queued for review — a human needs to apply it". For draft graph edits, use the canvas-control tools (focus_node/set_lens/set_zoom) to show the user the change, and remind them publishing stays their step (you can request it, you cannot publish).',
    'UI tools (navigate, highlight) run in the user\'s browser: use navigate to take the user to the page that shows what you found (all state is in the URL), and highlight to point at a specific record. Narrate what you are doing.',
    'Grounding: report numbers exactly as tools return them; if a tool returns empty or fails, say so plainly and continue with what you have. Never invent identifiers.',
    'Style: plain sentences, lead with the answer, keep it short. Use the org\'s vocabulary (cartons, lines, serials, feeds, nodes).',
    `Available tools: ${toolNames.join(', ')}.`,
  ].join('\n\n');
}

/** Volatile per-request context — rendered AFTER the cache breakpoint. */
export function buildContextFragment(context: AssistantPageContext | null | undefined): string {
  if (!context) return 'Page context: none provided.';
  const parts = [
    `Page context: the user is on "${context.page}"`,
    context.station ? `at station ${context.station}` : null,
    context.mode ? `in mode "${context.mode}"` : null,
    context.selection ? `with ${context.selection.kind} ${context.selection.id} selected` : null,
  ].filter(Boolean);
  const skill = context.skill ? `\n\nPage skill:\n${context.skill}` : '';
  return `${parts.join(', ')}.${skill}`;
}

// ─── Loop types ──────────────────────────────────────────────────────────────

export type AssistantEmit =
  | { type: 'delta'; text: string }
  | { type: 'tool_start'; name: string; input: unknown }
  | { type: 'tool_end'; name: string; ok: boolean }
  | { type: 'ui_tool'; name: string; input: unknown }
  | { type: 'error'; message: string };

export interface RunAssistantTurnArgs {
  ctx: AssistantToolCtx;
  /** Prior turns, oldest first (flat text history from ai_chat_messages). */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  context?: AssistantPageContext | null;
  /**
   * Per-request write tools (built with the chat sessionId) — filtered by
   * permission before use. Empty for read-only callers. Their .run() is
   * dispatched in-process (not via the read registry).
   */
  writeTools?: ReadonlyArray<AssistantToolDef<z.ZodTypeAny, unknown>>;
  /** Sink for streaming events to the client (SSE writer). */
  emit: (event: AssistantEmit) => void;
}

export interface RunAssistantTurnResult {
  ok: boolean;
  /** Final assistant text (what gets persisted + rendered). */
  text: string;
  turns: number;
  error?: string;
}

export interface AgentLoopDeps {
  /** Streams one model turn; returns the final message. Default = Anthropic SDK. */
  streamTurn: (
    params: {
      system: Anthropic.Messages.TextBlockParam[];
      messages: Anthropic.MessageParam[];
      tools: Anthropic.Tool[];
    },
    onTextDelta: (text: string) => void,
  ) => Promise<Anthropic.Message>;
  runTool: typeof runAssistantTool;
}

function makeDefaultDeps(): AgentLoopDeps {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured — the assistant is unavailable.');
  }
  const client = new Anthropic({ apiKey });
  return {
    streamTurn: async (params, onTextDelta) => {
      const stream = client.messages.stream({
        model: ASSISTANT_MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        system: params.system,
        messages: params.messages,
        tools: params.tools,
      });
      stream.on('text', onTextDelta);
      return stream.finalMessage();
    },
    runTool: runAssistantTool,
  };
}

// ─── The loop ────────────────────────────────────────────────────────────────

export async function runAssistantTurn(
  args: RunAssistantTurnArgs,
  deps: AgentLoopDeps | null = null,
): Promise<RunAssistantTurnResult> {
  const d = deps ?? makeDefaultDeps();

  const toSchema = (t: { name: string; description: string; inputSchema: z.ZodTypeAny }): Anthropic.Tool => ({
    name: t.name,
    description: t.description,
    // Zod 4 native JSON-schema derivation (the MCP-forward payoff of keeping
    // zod schemas in the registry).
    input_schema: {
      ...(z.toJSONSchema(t.inputSchema) as Record<string, unknown>),
      type: 'object',
    } as Anthropic.Tool.InputSchema,
  });

  const serverTools = listAssistantTools(args.ctx).map(toSchema);
  // Write tools filtered by permission; dispatched in-process by name.
  const writeDefs = (args.writeTools ?? []).filter((t) => args.ctx.permissions.has(t.permission));
  const writeMap = new Map(writeDefs.map((t) => [t.name, t]));
  const writeTools = writeDefs.map(toSchema);
  const tools = [...serverTools, ...writeTools, ...UI_TOOLS];

  async function runWriteTool(name: string, rawInput: unknown): Promise<AssistantToolRunResult> {
    const tool = writeMap.get(name);
    if (!tool) return { ok: false, code: 'unknown_tool', error: `Unknown write tool "${name}"` };
    if (!args.ctx.permissions.has(tool.permission)) {
      return { ok: false, code: 'forbidden', error: `Missing permission ${tool.permission}` };
    }
    const parsed = tool.inputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) return { ok: false, code: 'invalid_input', error: parsed.error.message };
    try {
      const data = await tool.run(parsed.data, args.ctx, {} as never);
      // A write tool that resolves with { ok: false, error } is a domain
      // failure (validation / 404 / 409), not a thrown error — surface it as
      // is_error so the model and any tool_end consumer see it as failed,
      // matching how read-tool failures are reported.
      if (data && typeof data === 'object' && (data as { ok?: unknown }).ok === false) {
        return { ok: false, code: 'tool_error', error: String((data as { error?: unknown }).error ?? 'write failed') };
      }
      return { ok: true, data };
    } catch (err) {
      return { ok: false, code: 'tool_error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  const system: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: buildSystemCore(tools.map((t) => t.name)),
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: buildContextFragment(args.context) },
  ];

  // The history window can start mid-conversation on an assistant turn, but
  // the API requires messages[0] to be a user message — trim leading
  // assistant turns (consecutive same-role later in the list is fine).
  const firstUser = args.history.findIndex((m) => m.role === 'user');
  const usableHistory = firstUser === -1 ? [] : args.history.slice(firstUser);
  const messages: Anthropic.MessageParam[] = [
    ...usableHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: args.userMessage },
  ];

  const turnTexts: string[] = [];
  let turns = 0;

  try {
    while (turns < MAX_TURNS) {
      turns += 1;
      // Separator between turns so streamed narration and persisted text agree
      // ("…checking now" + "Based on…" must not fuse).
      if (turnTexts.length > 0) args.emit({ type: 'delta', text: '\n\n' });
      const message = await d.streamTurn({ system, messages, tools }, (text) => {
        args.emit({ type: 'delta', text });
      });

      const textParts = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text);
      if (textParts.length > 0) turnTexts.push(textParts.join('\n'));

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }

      const toolUses = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (message.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      messages.push({ role: 'assistant', content: message.content });

      // Execute ALL tool calls, return ALL results in ONE user message.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        if (UI_TOOL_NAMES.has(call.name)) {
          // Client tool: forward to the browser, acknowledge to the model.
          args.emit({ type: 'ui_tool', name: call.name, input: call.input });
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'Dispatched to the user\'s browser.',
          });
          continue;
        }
        args.emit({ type: 'tool_start', name: call.name, input: call.input });
        const result = writeMap.has(call.name)
          ? await runWriteTool(call.name, call.input)
          : await d.runTool(call.name, call.input, args.ctx);
        args.emit({ type: 'tool_end', name: call.name, ok: result.ok });
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: result.ok ? JSON.stringify(result.data) : result.error,
          is_error: !result.ok || undefined,
        });
      }
      messages.push({ role: 'user', content: results });
    }

    let finalText = turnTexts.join('\n\n');
    if (turns >= MAX_TURNS && !finalText) {
      finalText = 'I ran out of steps while researching that — try a narrower question.';
    }
    return { ok: true, text: finalText, turns };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'assistant error';
    args.emit({ type: 'error', message });
    return { ok: false, text: turnTexts.join('\n\n'), turns, error: message };
  }
}
