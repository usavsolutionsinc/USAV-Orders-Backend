/**
 * POST /api/mcp — MCP (Model Context Protocol) endpoint exposing the assistant
 * READ-tool registry to power users (universal-feed plan Phase 5). Streamable-HTTP
 * request/response transport: one JSON-RPC 2.0 message (or a batch array) per
 * POST, answered with application/json.
 *
 * Auth: session-gated (withAuth, assistant.chat). org + permissions come from the
 * verified session; every tools/call re-checks the tool's own permission inside
 * runAssistantTool. Read-only — the AI write tools are never exposed here.
 *
 * GET returns 405 (no SSE server→client stream; the read tools are single-shot).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { listAssistantTools, runAssistantTool } from '@/lib/assistant/tools';
import { handleMcpMessage, type McpServerDeps } from '@/lib/mcp/tool-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Max JSON-RPC messages per POST. Each tools/call can fan out to several tenant
 * DB queries, so an uncapped batch would let one request storm the tenant pool.
 * Batches are processed SEQUENTIALLY (below) so even a full batch never runs
 * more than one tool's queries at a time.
 */
const MAX_BATCH = 20;

export const GET = withAuth(
  async () => NextResponse.json({ error: 'Use POST for MCP JSON-RPC' }, { status: 405 }),
  { permission: 'assistant.chat' },
);

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        { status: 400 },
      );
    }

    const toolCtx = {
      organizationId: ctx.organizationId,
      staffId: ctx.staffId,
      permissions: ctx.permissions,
    };
    const deps: McpServerDeps = {
      listTools: (c) => listAssistantTools(c),
      runTool: (name, args, c) => runAssistantTool(name, args, c),
    };

    const isBatch = Array.isArray(body);
    // JSON-RPC 2.0: an empty batch is a single Invalid Request.
    if (Array.isArray(body) && body.length === 0) {
      return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request (empty batch)' } });
    }
    // Cap the fan-out (DoS guard) before doing any work.
    if (Array.isArray(body) && body.length > MAX_BATCH) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Batch too large (max ${MAX_BATCH})` } },
        { status: 413 },
      );
    }

    const messages = (isBatch ? body : [body]) as Array<Record<string, unknown>>;
    // SEQUENTIAL — never run more than one message's tool queries concurrently,
    // so a batch can't storm the tenant DB pool.
    const responses = [];
    for (const m of messages) {
      const res = await handleMcpMessage(m, toolCtx, deps);
      if (res !== null) responses.push(res);
    }

    // All-notification POST → 202 Accepted, no body (JSON-RPC spec).
    if (responses.length === 0) return new NextResponse(null, { status: 202 });
    return NextResponse.json(isBatch ? responses : responses[0]);
  },
  { permission: 'assistant.chat' },
);
