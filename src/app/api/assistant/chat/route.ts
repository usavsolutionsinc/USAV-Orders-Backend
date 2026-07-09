import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimit } from '@/lib/api-guard';
import { runAssistantTurn, type AssistantEmit } from '@/lib/assistant/agent-loop';
import {
  enrichAssistantTurn,
  formatLocalOpsReply,
} from '@/lib/assistant/enrich-turn';
import { buildWriteTools } from '@/lib/assistant/tools/write-tools';
import { loadAssistantHistory, persistAssistantTurn } from '@/lib/assistant/chat-persistence';
import type { AssistantToolCtx } from '@/lib/assistant/tools/types';
import { getHermesApiUrl, getHermesHeaders, getHermesModel } from '@/lib/ai/hermes-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/assistant/chat — the global English assistant (plan §3.2/§3.3).
 * Claude tool-use loop over the org-scoped read-tool registry; SSE stream out
 * (meta → delta/tool/ui_tool → done).
 *
 * Pre-loop: local_ops fast path + enrichAssistantMessage (parity with Hermes
 * /api/ai/chat). Optional Hermes fallback when ANTHROPIC_API_KEY is absent and
 * ASSISTANT_HERMES_FALLBACK=1 (or Hermes is reachable in local dev).
 *
 * org/staff/permissions come from ctx — never the body.
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

function hermesFallbackEnabled(): boolean {
  const flag = String(process.env.ASSISTANT_HERMES_FALLBACK || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  // Local default: when Anthropic is missing, try Hermes (dev box).
  return !process.env.ANTHROPIC_API_KEY;
}

async function isHermesReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${getHermesApiUrl()}/models`, {
      headers: getHermesHeaders(),
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function streamHermesCompletion(args: {
  sessionId: string;
  enrichedMessage: string;
  write: (event: string, data: unknown) => void;
}): Promise<{ ok: boolean; text: string }> {
  const hermesRes = await fetch(`${getHermesApiUrl()}/chat/completions`, {
    method: 'POST',
    headers: getHermesHeaders({
      'Content-Type': 'application/json',
      'X-Hermes-Session-Id': args.sessionId,
      'X-Source': 'assistant',
    }),
    body: JSON.stringify({
      model: getHermesModel(),
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            'You are the operations assistant. Answer from the live data blocks in the user message. Keep answers concrete and short. Cite record links when present.',
        },
        { role: 'user', content: args.enrichedMessage },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!hermesRes.ok || !hermesRes.body) {
    const detail = await hermesRes.text().catch(() => '');
    args.write('error', { message: `Hermes unavailable (${hermesRes.status}): ${detail.slice(0, 200)}` });
    return { ok: false, text: '' };
  }

  const reader = hermesRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          args.write('delta', { text: delta });
        }
      } catch {
        /* ignore malformed chunks */
      }
    }
  }
  return { ok: text.length > 0, text };
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
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

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const useHermes = !hasAnthropic && hermesFallbackEnabled() && (await isHermesReachable());
  if (!hasAnthropic && !useHermes) {
    return NextResponse.json(
      {
        error: 'assistant_unconfigured',
        detail: 'ANTHROPIC_API_KEY is not set and Hermes fallback is unavailable.',
      },
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
          /* client went away */
        }
      };
      write('meta', { sessionId, provider: useHermes ? 'hermes' : 'anthropic' });

      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(ping);
        }
      }, 15_000);

      try {
        const prepared = await enrichAssistantTurn(ctx.organizationId, message);

        // Local-ops fast path — deterministic shipping pace, no model cost.
        if (prepared.kind === 'local_ops') {
          const text = formatLocalOpsReply(prepared.resolution);
          write('delta', { text });
          await persistAssistantTurn(ctx.organizationId, sessionId, 'assistant', text);
          write('done', { ok: true, turns: 0, mode: 'local_ops' });
          return;
        }

        if (useHermes) {
          const hermes = await streamHermesCompletion({
            sessionId,
            enrichedMessage: prepared.userMessage,
            write,
          });
          if (hermes.text) {
            await persistAssistantTurn(ctx.organizationId, sessionId, 'assistant', hermes.text);
          }
          write('done', { ok: hermes.ok, turns: 1, mode: 'hermes' });
          return;
        }

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
          userMessage: prepared.userMessage,
          context: context ?? null,
          writeTools: buildWriteTools(sessionId),
          emit,
        });

        if (result.text) {
          await persistAssistantTurn(ctx.organizationId, sessionId, 'assistant', result.text);
        }
        write('done', { ok: result.ok, turns: result.turns });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        write('error', { message: msg });
        write('done', { ok: false, turns: 0 });
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
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
