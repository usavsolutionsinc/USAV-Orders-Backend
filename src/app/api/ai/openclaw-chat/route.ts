import { NextRequest, NextResponse } from 'next/server';
import { buildContextBlock } from '@/lib/ai/context-fetchers';
import { detectIntents, extractParams } from '@/lib/ai/intent-router';
import { formatAnalysisForPrompt, resolveLocalAiAnswer } from '@/lib/ai/ops-assistant';
import { queryNemoClawRag } from '@/lib/ai/nemoclaw-rag';
import { checkRateLimit } from '@/lib/api-guard';
import { persistChatMessage } from '@/lib/ai/chat-persistence';
import type { AiChatRouteResponse, AiStructuredAnswer } from '@/lib/ai/types';

export const runtime = 'nodejs';

type OpenClawChatBody = {
  sessionId?: string;
  message?: string;
};

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const OPENCLAW_USAV_TOKEN = process.env.OPENCLAW_USAV_TOKEN || '';

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
    const body = (await req.json().catch(() => ({}))) as OpenClawChatBody;
    const { sessionId, message } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const trimmedMessage = message.trim();

    // Persist user message (fire-and-forget)
    void persistChatMessage({ sessionId, role: 'user', content: trimmedMessage });

    // 1. Try local ops resolution first (deterministic DB queries — no model needed)
    const localResolution = await resolveLocalAiAnswer(trimmedMessage);

    if (localResolution?.mode === 'local_ops') {
      console.info('[openclaw-chat] local ops answer', {
        kind: localResolution.analysis.kind,
        title: localResolution.analysis.title,
        confidence: localResolution.analysis.confidence,
      });

      const localPayload: AiChatRouteResponse = {
        reply: localResolution.reply,
        sessionId,
        mode: localResolution.mode,
        analysis: localResolution.analysis,
      };
      void persistChatMessage({ sessionId, role: 'assistant', content: localResolution.reply, mode: localResolution.mode, analysis: localResolution.analysis });
      return NextResponse.json(localPayload);
    }

    // 2. Intent detection + context enrichment from live DB data
    const intents = detectIntents(trimmedMessage);
    const params = extractParams(trimmedMessage, intents);

    // 2b. Bose manual RAG intercept — routes through rag.michaelgarisek.com tunnel
    if (intents.includes('bose_manual')) {
      try {
        const ragResult = await queryNemoClawRag(trimmedMessage);

        if (ragResult.answer) {
          const topScore = ragResult.chunks[0]?.score;
          const confidence =
            typeof topScore === 'number'
              ? topScore >= 0.7 ? 'high' : topScore >= 0.4 ? 'medium' : 'low'
              : 'medium';

          const analysis: AiStructuredAnswer = {
            kind: 'repair_diagnostics',
            title: 'Bose Service Manual Reference',
            summary: ragResult.answer,
            confidence,
            modeLabel: 'Bose Manual RAG',
            sources: ragResult.sources.map((src, i) => ({
              id: `rag-src-${i}`,
              label: src,
              detail: `Source: ${src}`,
            })),
            followUps: [
              'What parts are needed for this repair?',
              'Show the wiring diagram for this model',
              'What are the specs for this speaker?',
              'Are there known issues with this model?',
            ],
          };

          console.info('[openclaw-chat] Bose RAG answer', {
            sources: ragResult.sources.length,
            chunks: ragResult.chunks.length,
            confidence,
          });

          const ragPayload: AiChatRouteResponse = {
            reply: ragResult.answer,
            sessionId,
            mode: 'rag',
            analysis,
          };
          void persistChatMessage({ sessionId, role: 'assistant', content: ragResult.answer, mode: 'rag', analysis });
          return NextResponse.json(ragPayload);
        }
      } catch (ragErr: any) {
        console.warn('[openclaw-chat] NemoClaw RAG failed (non-fatal), falling through to OpenClaw:', ragErr?.message);
      }
    }

    let enrichedMessage = trimmedMessage;
    if (localResolution?.analysis) {
      enrichedMessage =
        `[Structured USAV ops data]\n${formatAnalysisForPrompt(localResolution.analysis)}\n\nUser question: ${trimmedMessage}`;
    }
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
        console.error('[openclaw-chat] context fetch error (non-fatal):', err);
      }
    }

    // 3. Send to OpenClaw gateway — it handles all model routing internally
    if (!OPENCLAW_GATEWAY_URL) {
      return NextResponse.json(
        { error: 'OPENCLAW_GATEWAY_URL not configured' },
        { status: 503 },
      );
    }

    const openclawRes = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_USAV_TOKEN}`,
        'X-Source': 'usav',
      },
      body: JSON.stringify({
        model: 'openclaw/usav-ops',
        messages: [
          {
            role: 'system',
            content:
              'You are the USAV Ops Assistant specializing in Bose product repair and warehouse operations. ' +
              'Answer questions about Bose speakers, amplifiers, receivers, and audio equipment repair. ' +
              'Provide specific part numbers, troubleshooting steps, and repair procedures when possible. ' +
              'Be concise and practical.',
          },
          { role: 'user', content: enrichedMessage },
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!openclawRes.ok) {
      const errBody = await openclawRes.text().catch(() => '');
      console.error('[openclaw-chat] gateway error:', openclawRes.status, errBody.slice(0, 300));
      return NextResponse.json(
        { error: `AI backend returned ${openclawRes.status}` },
        { status: 502 },
      );
    }

    const data = await openclawRes.json();
    const rawReply =
      data?.choices?.[0]?.message?.content ||
      data?.reply ||
      'No response received.';

    // Strip <think>...</think> reasoning blocks if model includes them
    const reply = rawReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || rawReply;

    console.info('[openclaw-chat] OpenClaw answered', {
      model: data?.model ?? 'openclaw/usav-ops',
      chars: reply.length,
    });

    const finalMode = localResolution?.analysis ? 'hybrid' : 'assistant';
    const payload: AiChatRouteResponse = {
      reply: String(reply).trim(),
      sessionId,
      mode: finalMode,
      analysis: localResolution?.analysis ?? null,
    };
    void persistChatMessage({ sessionId, role: 'assistant', content: String(reply).trim(), mode: finalMode, analysis: localResolution?.analysis });
    return NextResponse.json(payload);
  } catch (err: any) {
    console.error('[openclaw-chat] Error:', err?.message);
    return NextResponse.json(
      { error: err?.message ?? 'Chat request failed' },
      { status: 503 },
    );
  }
}
