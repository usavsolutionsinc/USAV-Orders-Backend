import { NextRequest, NextResponse } from 'next/server';
import { getTunnelUrl } from '@/lib/ai/tunnel-config';
import { buildContextBlock } from '@/lib/ai/context-fetchers';
import { detectIntents, extractParams } from '@/lib/ai/intent-router';
import { checkRateLimit } from '@/lib/api-guard';

export const runtime = 'nodejs';

type TunnelChatBody = {
  sessionId?: string;
  message?: string;
};

export async function POST(req: NextRequest) {
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

  try {
    const body = (await req.json().catch(() => ({}))) as TunnelChatBody;
    const { sessionId, message } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const trimmedMessage = message.trim();
    const intents = detectIntents(trimmedMessage);
    const params = extractParams(trimmedMessage, intents);

    let enrichedMessage = trimmedMessage;
    if (intents.length > 0) {
      try {
        const contextBlock = await buildContextBlock(intents, params);
        if (contextBlock) {
          enrichedMessage =
            `[Live USAV data - ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST]\n` +
            contextBlock +
            `\n\nUser question: ${trimmedMessage}`;
        }
      } catch (err) {
        console.error('[tunnel-chat] context fetch error (non-fatal):', err);
      }
    }

    const tunnelUrl = await getTunnelUrl();
    const apiKey = process.env.AI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'AI_API_KEY not configured on server' }, { status: 500 });
    }

    const upstream = await fetch(`${tunnelUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ session_id: sessionId, message: enrichedMessage }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: data?.error ?? 'Chatbot backend error' },
        { status: upstream.status }
      );
    }

    return NextResponse.json({ reply: data.reply, sessionId: data.session_id ?? sessionId });
  } catch (err: any) {
    console.error('[tunnel-chat] Error:', err?.message);
    return NextResponse.json(
      { error: err?.message ?? 'Chat request failed' },
      { status: 503 }
    );
  }
}
