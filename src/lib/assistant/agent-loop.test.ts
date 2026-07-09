/**
 * DB-free/network-free tests for the assistant agent loop. A fake `streamTurn`
 * scripts model turns; a fake `runTool` captures registry calls.
 * Run: npm run test:assistant
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { runAssistantTurn, type AgentLoopDeps, type AssistantEmit } from './agent-loop';
import type { AssistantToolCtx } from './tools/types';

const ORG = '11111111-2222-3333-4444-555555555555';
const CTX: AssistantToolCtx = {
  organizationId: ORG,
  staffId: 7,
  permissions: new Set(['dashboard.view', 'studio.view']),
};

type ScriptedTurn = {
  content: Anthropic.Message['content'];
  stop_reason: Anthropic.Message['stop_reason'];
};

function msg(turn: ScriptedTurn): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-8',
    content: turn.content,
    stop_reason: turn.stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as Anthropic.Message;
}

function fakes(turnsScript: ScriptedTurn[], toolResult: (name: string) => { ok: boolean }) {
  const cap = {
    requests: [] as Array<{ messages: Anthropic.MessageParam[]; toolNames: string[]; system: Anthropic.Messages.TextBlockParam[] }>,
    toolCalls: [] as Array<{ name: string; input: unknown; orgId: string }>,
    emitted: [] as AssistantEmit[],
  };
  let i = 0;
  const deps: AgentLoopDeps = {
    streamTurn: async (params, onTextDelta) => {
      cap.requests.push({
        messages: params.messages,
        toolNames: params.tools.map((t) => t.name),
        system: params.system,
      });
      const turn = turnsScript[Math.min(i, turnsScript.length - 1)];
      i += 1;
      for (const block of turn.content) {
        if (block.type === 'text') onTextDelta(block.text);
      }
      return msg(turn);
    },
    runTool: async (name, input, ctx) => {
      cap.toolCalls.push({ name, input, orgId: ctx.organizationId });
      const r = toolResult(name);
      return r.ok
        ? { ok: true, data: { rows: [1, 2, 3] } }
        : { ok: false, code: 'tool_error', error: `${name} failed: boom` };
    },
  };
  const emit = (e: AssistantEmit) => cap.emitted.push(e);
  return { deps, cap, emit };
}

test('tool loop: executes server tool, feeds result back, ends on end_turn', async () => {
  const { deps, cap, emit } = fakes(
    [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tu_1', name: 'get_top_reasons', input: { rangeDays: 7 } },
        ] as Anthropic.Message['content'],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Top reason is no-audio failures.' }] as Anthropic.Message['content'],
      },
    ],
    () => ({ ok: true }),
  );

  const out = await runAssistantTurn(
    { ctx: CTX, history: [], userMessage: 'why are units failing?', emit },
    deps,
  );

  assert.equal(out.ok, true);
  assert.equal(out.turns, 2);
  // Narration accumulates across turns (matches what the client streamed).
  assert.equal(out.text, 'Let me check.\n\nTop reason is no-audio failures.');
  assert.deepEqual(cap.toolCalls, [{ name: 'get_top_reasons', input: { rangeDays: 7 }, orgId: ORG }]);

  // Second request carries assistant tool_use turn + ONE user message of tool_results.
  const second = cap.requests[1].messages;
  assert.equal(second[second.length - 2].role, 'assistant');
  const resultMsg = second[second.length - 1];
  assert.equal(resultMsg.role, 'user');
  const blocks = resultMsg.content as Anthropic.ToolResultBlockParam[];
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tool_use_id, 'tu_1');
  assert.ok(!blocks[0].is_error);

  // Streaming sink saw deltas + tool lifecycle.
  assert.ok(cap.emitted.some((e) => e.type === 'delta'));
  assert.deepEqual(
    cap.emitted.filter((e) => e.type === 'tool_start').map((e) => (e as { name: string }).name),
    ['get_top_reasons'],
  );
});

test('UI tool: forwarded to the client sink, acknowledged to the model, loop continues', async () => {
  const { deps, cap, emit } = fakes(
    [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_nav', name: 'navigate', input: { path: '/operations', params: { mode: 'analytics' } } },
        ] as Anthropic.Message['content'],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Taking you there.' }] as Anthropic.Message['content'],
      },
    ],
    () => ({ ok: true }),
  );

  const out = await runAssistantTurn({ ctx: CTX, history: [], userMessage: 'show me analytics', emit }, deps);

  assert.equal(out.ok, true);
  assert.equal(cap.toolCalls.length, 0); // never hit the server registry
  const ui = cap.emitted.find((e) => e.type === 'ui_tool') as { name: string; input: { path: string } };
  assert.equal(ui.name, 'navigate');
  assert.equal(ui.input.path, '/operations');
  // Model got an acknowledgment tool_result.
  const blocks = cap.requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.match(String(blocks[0].content), /Dispatched/);
});

test('failing server tool surfaces as is_error tool_result; loop keeps going', async () => {
  const { deps, cap, emit } = fakes(
    [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_bad', name: 'get_kpis', input: {} },
        ] as Anthropic.Message['content'],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'The KPI source is unavailable right now.' }] as Anthropic.Message['content'],
      },
    ],
    () => ({ ok: false }),
  );

  const out = await runAssistantTurn({ ctx: CTX, history: [], userMessage: 'kpis?', emit }, deps);
  assert.equal(out.ok, true);
  const blocks = cap.requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(blocks[0].is_error, true);
  assert.match(String(blocks[0].content), /failed/);
});

test('hard iteration cap: a model that never stops tool-calling gets cut off', async () => {
  const { deps, emit } = fakes(
    [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_loop', name: 'get_kpis', input: {} },
        ] as Anthropic.Message['content'],
      },
    ],
    () => ({ ok: true }),
  );
  const out = await runAssistantTurn({ ctx: CTX, history: [], userMessage: 'loop forever', emit }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.turns, 8);
  assert.match(out.text, /ran out of steps/);
});

test('prompt-cache discipline: stable core has cache_control; volatile context after it', async () => {
  const { deps, cap, emit } = fakes(
    [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] as Anthropic.Message['content'] }],
    () => ({ ok: true }),
  );
  await runAssistantTurn(
    {
      ctx: CTX,
      history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'earlier reply' }],
      userMessage: 'hello',
      context: { page: 'operations', mode: 'analytics', skill: 'KPI vocab' },
      emit,
    },
    deps,
  );
  const { system, messages, toolNames } = cap.requests[0];
  assert.equal(system.length, 2);
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral' });
  assert.equal(system[1].cache_control, undefined);
  assert.match(system[1].text, /operations/);
  assert.match(system[1].text, /KPI vocab/);
  assert.equal(messages.length, 3); // history + new user msg
  // permission-filtered registry (full ctx) + UI namespace
  assert.ok(toolNames.includes('get_graph'));
  assert.ok(toolNames.includes('navigate'));
  assert.ok(toolNames.includes('focus_node'));
});

test('streamTurn throw → emitted error + ok:false (route maps to SSE error, not a 500 crash)', async () => {
  const deps: AgentLoopDeps = {
    streamTurn: async () => {
      throw new Error('overloaded');
    },
    runTool: async () => ({ ok: true, data: {} }),
  };
  const emitted: AssistantEmit[] = [];
  const out = await runAssistantTurn(
    { ctx: CTX, history: [], userMessage: 'hi', emit: (e) => emitted.push(e) },
    deps,
  );
  assert.equal(out.ok, false);
  assert.equal(out.error, 'overloaded');
  assert.deepEqual(emitted, [{ type: 'error', message: 'overloaded' }]);
});

test('history starting on an assistant turn is trimmed (first message must be user)', async () => {
  const { deps, cap, emit } = fakes(
    [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] as Anthropic.Message['content'] }],
    () => ({ ok: true }),
  );
  await runAssistantTurn(
    {
      ctx: CTX,
      history: [
        { role: 'assistant', content: 'orphaned reply from a cut window' },
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
      ],
      userMessage: 'now',
      emit,
    },
    deps,
  );
  const messages = cap.requests[0].messages;
  assert.equal(messages[0].role, 'user'); // leading assistant trimmed
  assert.equal(messages.length, 3);
});

test('multi-turn narration accumulates: persisted text matches streamed deltas incl. separators', async () => {
  const { deps, cap, emit } = fakes(
    [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Checking the KPIs…' },
          { type: 'tool_use', id: 'tu_1', name: 'get_kpis', input: {} },
        ] as Anthropic.Message['content'],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Shipped 200, returned 18.' }] as Anthropic.Message['content'],
      },
    ],
    () => ({ ok: true }),
  );
  const out = await runAssistantTurn({ ctx: CTX, history: [], userMessage: 'kpis', emit }, deps);
  assert.equal(out.text, 'Checking the KPIs…\n\nShipped 200, returned 18.');
  const streamed = cap.emitted
    .filter((e) => e.type === 'delta')
    .map((e) => (e as { text: string }).text)
    .join('');
  assert.equal(streamed, out.text); // live bubble === persisted history
});
