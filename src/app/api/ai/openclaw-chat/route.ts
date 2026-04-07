import { NextRequest, NextResponse } from 'next/server';
import { buildContextBlock } from '@/lib/ai/context-fetchers';
import { detectIntents, extractParams } from '@/lib/ai/intent-router';
import { formatAnalysisForPrompt, resolveLocalAiAnswer } from '@/lib/ai/ops-assistant';
import { queryNemoClawRag } from '@/lib/ai/nemoclaw-rag';
import { checkRateLimit } from '@/lib/api-guard';
import type { AiChatRouteResponse, AiStructuredAnswer } from '@/lib/ai/types';

export const runtime = 'nodejs';

type OpenClawChatBody = {
  sessionId?: string;
  message?: string;
};

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const OPENCLAW_USAV_TOKEN = process.env.OPENCLAW_USAV_TOKEN || '';

// Mac LM Studio with Qwen3-32B — used for Bose manual synthesis and as primary fallback
const MAC_LM_STUDIO_URL = process.env.MAC_LM_STUDIO_URL || 'http://100.64.38.223:8080';
const MAC_LM_STUDIO_MODEL = process.env.MAC_LM_STUDIO_MODEL || 'qwen/qwen3-32b';

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

    // 1. Try local ops resolution first (deterministic DB queries)
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
      return NextResponse.json(localPayload);
    }

    // 2. Intent detection + context enrichment
    const intents = detectIntents(trimmedMessage);
    const params = extractParams(trimmedMessage, intents);

    // 2b. Bose manual RAG intercept — routes to NemoClaw if available
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
          return NextResponse.json(ragPayload);
        }
      } catch (ragErr: any) {
        console.warn('[openclaw-chat] NemoClaw RAG failed (non-fatal), falling through:', ragErr?.message);
        // Fall through to Mac LM Studio / OpenClaw / Ollama
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

    // 3. Try Mac LM Studio (Qwen3-32B) — fast, powerful, local network
    try {
      const macRes = await fetch(`${MAC_LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer lm-studio',
        },
        body: JSON.stringify({
          model: MAC_LM_STUDIO_MODEL,
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

      if (macRes.ok) {
        const data = await macRes.json();
        const rawReply = data?.choices?.[0]?.message?.content || 'No response received.';
        // Strip Qwen3 <think>...</think> reasoning blocks if present
        const reply = rawReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || rawReply;

        console.info('[openclaw-chat] Mac LM Studio answered', {
          model: MAC_LM_STUDIO_MODEL,
          chars: reply.length,
        });

        const payload: AiChatRouteResponse = {
          reply: String(reply).trim(),
          sessionId,
          mode: localResolution?.analysis ? 'hybrid' : 'assistant',
          analysis: localResolution?.analysis ?? null,
        };
        return NextResponse.json(payload);
      }

      console.warn('[openclaw-chat] Mac LM Studio returned non-OK:', macRes.status);
    } catch (err: any) {
      console.warn('[openclaw-chat] Mac LM Studio unreachable, trying OpenClaw:', err?.message);
    }

    // 4. Try OpenClaw Gateway (local Qwen3:8b)
    if (OPENCLAW_GATEWAY_URL && OPENCLAW_USAV_TOKEN) {
      try {
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
              { role: 'user', content: enrichedMessage },
            ],
            stream: false,
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (openclawRes.ok) {
          const data = await openclawRes.json();
          const reply =
            data?.choices?.[0]?.message?.content ||
            data?.reply ||
            'No response received.';

          // Check for timeout messages from the gateway
          if (reply.includes('timed out') || reply.includes('Request timed out')) {
            console.warn('[openclaw-chat] OpenClaw gateway timed out internally');
          } else {
            const payload: AiChatRouteResponse = {
              reply: String(reply).trim(),
              sessionId,
              mode: localResolution?.analysis ? 'hybrid' : 'assistant',
              analysis: localResolution?.analysis ?? null,
            };
            return NextResponse.json(payload);
          }
        }

        console.warn('[openclaw-chat] Gateway returned non-OK:', openclawRes.status);
      } catch (err: any) {
        console.warn('[openclaw-chat] Gateway unreachable, falling back to Ollama:', err?.message);
      }
    }

    // 5. Fallback: local Ollama via /api/ai/chat
    // NOTE: /api/ai/chat expects { query } not { message }
    try {
      const fallbackRes = await fetch(
        new URL('/api/ai/chat', req.nextUrl.origin).toString(),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            query: enrichedMessage,
            messages: [{ role: 'user', content: enrichedMessage }],
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );

      const fallbackData = await fallbackRes.json();

      if (!fallbackRes.ok) {
        return NextResponse.json(
          { error: fallbackData?.error ?? 'Chatbot backend error' },
          { status: fallbackRes.status }
        );
      }

      const payload: AiChatRouteResponse = {
        reply: String(fallbackData.response || fallbackData.reply || '').trim() || 'No response received.',
        sessionId: fallbackData.sessionId ?? sessionId,
        mode: localResolution?.analysis ? 'hybrid' : 'assistant',
        analysis: localResolution?.analysis ?? null,
      };

      return NextResponse.json({ ...payload, fallback: true });
    } catch (fallbackErr: any) {
      console.error('[openclaw-chat] Fallback also failed:', fallbackErr?.message);
      return NextResponse.json(
        { error: 'All AI backends are unavailable. Check Mac LM Studio, OpenClaw, and Ollama.' },
        { status: 503 }
      );
    }
  } catch (err: any) {
    console.error('[openclaw-chat] Error:', err?.message);
    return NextResponse.json(
      { error: err?.message ?? 'Chat request failed' },
      { status: 503 },
    );
  }
}
