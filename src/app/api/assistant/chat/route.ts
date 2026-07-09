import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimit } from '@/lib/api-guard';
import { runAssistantTurn, type AssistantEmit } from '@/lib/assistant/agent-loop';
import { buildWriteTools } from '@/lib/assistant/tools/write-tools';
import { loadAssistantHistory, persistAssistantTurn } from '@/lib/assistant/chat-persistence';
import type { AssistantToolCtx } from '@/lib/assistant/tools/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/assistant/chat — the global English assistant (plan §3.2/§3.3).
 * Claude tool-use loop over the org-scoped read-tool registry; SSE stream out
 * (meta → delta/tool/ui_tool → done). Read/explain only in this release.
 *
 * org/staff/permissions come from ctx — never the body. Page context (incl.
 * the page's registered skill fragment) rides the body; it can only shape
 * PROMPT TEXT for this user's own turn — every tool call re-validates
 * permissions server-side, so it grants nothing.
 */

const ContextSchema = z
  .object({
    page: z.string().min(1).max(80),
    station: z.string().max(40).nullish(),
    mode: z.string().max(80).nullish(),
    selection: z
      .object({ kind: z.string().max(40), id: z.union([z.string().max(80), z.number().int()]) })
      .nullish(),
    skill: z.string().max(4000).nullish(),
  })
  .strict();

const BodySchema = z
  .object({
    sessionId: z.string().regex(/^[A-Za-z0-9._-]{8,80}$/),
    message: z.string().min(1).max(4000),
    context: ContextSchema.nullish(),
  })
  .strict();

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  // Same guard as the legacy ai-chat routes — this endpoint spends real model
  // dollars per call.
  const rate = checkRateLimit({
    headers: req.headers,
    routeKey: 'assistant-chat',
    limit: Number(process.env.ASSISTANT_CHAT_RATE_LIMIT || 25),
    windowMs: 60 * 1000,
  });
  if (!rate.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', detail: parsed.error.message }, { status: 400 });
  }
  const { sessionId, message, context } = parsed.data;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'assistant_unconfigured', detail: 'ANTHROPIC_API_KEY is not set on the server.' },
      { status: 503 },
    );
  }

  const toolCtx: AssistantToolCtx = {
    organizationId: ctx.organizationId,
    staffId: ctx.staffId ?? null,
    permissions: ctx.permissions,
  };

  const history = await loadAssistantHistory(ctx.organizationId, sessionId).catch(() => []);
  await persistAssistantTurn(ctx.organizationId, sessionId, 'user', message);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          // client went away mid-stream — the loop finishes server-side
        }
      };
      write('meta', { sessionId });

      // Keep-alive for proxies/CDNs during long tool loops (house SSE pattern).
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(ping);
        }
      }, 15_000);

      const emit = (e: AssistantEmit) => {
        if (e.type === 'delta') write('delta', { text: e.text });
        else if (e.type === 'tool_start') write('tool', { name: e.name, status: 'start' });
        else if (e.type === 'tool_end') write('tool', { name: e.name, status: 'end', ok: e.ok });
        else if (e.type === 'ui_tool') write('ui_tool', { name: e.name, input: e.input });
        else if (e.type === 'error') write('error', { message: e.message });
      };

      const result = await runAssistantTurn({
        ctx: toolCtx,
        history,
        userMessage: message,
        context: context ?? null,
        // Write tools are permission-filtered inside the loop; a viewer
        // without studio.manage simply never sees propose/revert.
        writeTools: buildWriteTools(sessionId),
        emit,
      });

      if (result.text) {
        await persistAssistantTurn(ctx.organizationId, sessionId, 'assistant', result.text);
      }
      write('done', { ok: result.ok, turns: result.turns });
      clearInterval(ping);
      try {
        controller.close();
      } catch {
        // stream already cancelled client-side
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}, { permission: 'assistant.chat' });
