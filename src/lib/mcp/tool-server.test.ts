/**
 * DB-free tests for the MCP JSON-RPC dispatch (Phase 5).
 * Run: npx tsx --test src/lib/mcp/tool-server.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  handleMcpMessage,
  MCP_PROTOCOL_VERSION,
  type McpServerDeps,
} from './tool-server';
import type { AssistantToolCtx, AssistantToolRunResult } from '@/lib/assistant/tools/types';

const CTX: AssistantToolCtx = {
  organizationId: '11111111-2222-3333-4444-555555555555' as AssistantToolCtx['organizationId'],
  staffId: 7,
  permissions: new Set(['assistant.chat']),
};

function fakes(runResult: AssistantToolRunResult = { ok: true, data: { rows: 3 } }) {
  const cap = { ran: [] as Array<{ name: string; args: unknown }> };
  const deps: McpServerDeps = {
    listTools: () => [
      { name: 'get_kpis', description: 'KPIs', permission: 'operations.view', inputSchema: z.object({ rangeDays: z.number().optional() }) },
    ],
    runTool: async (name, args) => {
      cap.ran.push({ name, args });
      return runResult;
    },
  };
  return { deps, cap };
}

test('initialize returns protocol version + tools capability + serverInfo', async () => {
  const { deps } = fakes();
  const res = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }, CTX, deps);
  assert.equal(res?.error, undefined);
  const result = res?.result as { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
  assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.equal(result.serverInfo.name, 'usav-assistant-tools');
});

test('tools/list returns each tool with a JSON-schema inputSchema', async () => {
  const { deps } = fakes();
  const res = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, CTX, deps);
  const tools = (res?.result as { tools: Array<{ name: string; inputSchema: { type?: string } }> }).tools;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'get_kpis');
  assert.equal(tools[0].inputSchema.type, 'object'); // z.toJSONSchema converted it
});

test('tools/call success → text content with JSON data, isError false', async () => {
  const { deps, cap } = fakes({ ok: true, data: { rows: 3 } });
  const res = await handleMcpMessage(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_kpis', arguments: { rangeDays: 7 } } },
    CTX,
    deps,
  );
  const result = res?.result as { content: Array<{ type: string; text: string }>; isError: boolean };
  assert.equal(result.isError, false);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), { rows: 3 });
  assert.deepEqual(cap.ran, [{ name: 'get_kpis', args: { rangeDays: 7 } }]); // org NOT from client
});

test('tools/call tool failure → isError true content, not a JSON-RPC error', async () => {
  const { deps } = fakes({ ok: false, code: 'forbidden', error: 'Missing permission operations.view for get_kpis' });
  const res = await handleMcpMessage(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_kpis' } },
    CTX,
    deps,
  );
  assert.equal(res?.error, undefined); // NOT a protocol error
  const result = res?.result as { content: Array<{ text: string }>; isError: boolean };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Missing permission/);
});

test('tools/call without a name → JSON-RPC invalid params (-32602)', async () => {
  const { deps } = fakes();
  const res = await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} }, CTX, deps);
  assert.equal(res?.error?.code, -32602);
});

test('notifications/initialized → no response (null)', async () => {
  const { deps } = fakes();
  const res = await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, CTX, deps);
  assert.equal(res, null);
});

test('unknown method → method not found (-32601)', async () => {
  const { deps } = fakes();
  const res = await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, CTX, deps);
  assert.equal(res?.error?.code, -32601);
});

test('malformed message (missing jsonrpc) with an id → invalid request (-32600)', async () => {
  const { deps } = fakes();
  const res = await handleMcpMessage({ id: 7, method: 'initialize' } as never, CTX, deps);
  assert.equal(res?.error?.code, -32600);
});

test('ping → empty result', async () => {
  const { deps } = fakes();
  const res = await handleMcpMessage({ jsonrpc: '2.0', id: 8, method: 'ping' }, CTX, deps);
  assert.deepEqual(res?.result, {});
});
