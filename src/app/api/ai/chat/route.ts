import { NextRequest, NextResponse } from 'next/server';
import { chatWithOllama, OllamaMessage } from '@/lib/ai/ollama';
import { checkRateLimit } from '@/lib/api-guard';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { publishAiAssistantMessage } from '@/lib/realtime/publish';

export const runtime = 'nodejs';

type ChatRequestBody = {
  sessionId?: string;
  page?: string;
  query?: string;
  context?: Record<string, unknown>;
  messages?: OllamaMessage[];
  model?: string;
  temperature?: number;
  channel?: string;
};

function sanitizeSessionId(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().slice(0, 120);
  if (!normalized) return null;
  return normalized.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

function buildMessages(input: ChatRequestBody): OllamaMessage[] {
  const system =
    'You are USAV Ops Assistant. Use provided page context only, keep answers concise, and state uncertainty when context is missing.';

  const base: OllamaMessage[] = [{ role: 'system', content: system }];

  if (input.page || input.context) {
    base.push({
      role: 'system',
      content: `Page: ${input.page || 'unknown'}\nContext JSON:\n${JSON.stringify(input.context || {}, null, 2)}`,
    });
  }

  if (Array.isArray(input.messages) && input.messages.length > 0) {
    const trimmed = input.messages
      .filter((msg) => msg && typeof msg.content === 'string' && msg.content.trim().length > 0)
      .slice(-12)
      .map((msg) => ({ role: msg.role, content: msg.content.trim().slice(0, 4000) }));
    return [...base, ...trimmed];
  }

  const query = String(input.query || '').trim();
  if (!query) return base;
  return [...base, { role: 'user', content: query.slice(0, 4000) }];
}

export async function POST(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const rate = checkRateLimit({
      headers: req.headers,
      routeKey: 'ai-chat',
      limit: Number(process.env.AI_CHAT_RATE_LIMIT || 25),
      windowMs: 60 * 1000,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again shortly.' },
        {
          status: 429,
          headers: rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : undefined,
        }
      );
    }

    const body = (await req.json().catch(() => ({}))) as ChatRequestBody;
    const messages = buildMessages(body);
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');

    if (!lastUserMessage) {
      return NextResponse.json({ error: 'Missing query or user messages' }, { status: 400 });
    }

    const result = await chatWithOllama({
      model: body.model,
      messages,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
    });

    const sessionId = sanitizeSessionId(body.sessionId || req.headers.get('x-ai-session') || undefined);
    const channel = body.channel || req.headers.get('x-ai-channel') || undefined;

    if (sessionId && channel) {
      await publishAiAssistantMessage({
        channel,
        sessionId,
        prompt: lastUserMessage.content,
        answer: result.content,
        model: result.model,
      });
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      model: result.model,
      response: result.content,
      usage: {
        promptEvalCount: result.promptEvalCount,
        evalCount: result.evalCount,
        totalDuration: result.totalDuration,
      },
    });
  } catch (error: any) {
    console.error('AI chat failed:', error);
    return NextResponse.json(
      { error: 'AI chat request failed', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
