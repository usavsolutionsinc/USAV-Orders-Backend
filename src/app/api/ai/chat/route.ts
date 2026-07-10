/**
 * AI Chat — POST endpoint backing AiChatPanel.tsx and AiChatWorkspace.tsx.
 * The backend is the local Hermes gateway on 127.0.0.1:8642
 * (NousResearch/hermes-agent), reached from Vercel via Cloudflare tunnel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { detectIntents } from '@/lib/ai/intent-router';
import { queryNemoClawRag } from '@/lib/ai/nemoclaw-rag';
import { checkRateLimitForOrg } from '@/lib/api-guard';
import { persistChatMessage } from '@/lib/ai/chat-persistence';
import { getHermesApiUrl, getHermesHeaders, getHermesModel } from '@/lib/ai/hermes-client';
import type { AiChatRouteResponse, AiStructuredAnswer } from '@/lib/ai/types';
import { enrichAssistantTurn } from '@/lib/assistant/enrich-turn';
import { withAuth } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

type AiChatBody = {
  sessionId?: string;
  message?: string;
};

// Local Hermes gateway — OpenAI-compatible API server exposed by
// NousResearch/hermes-agent (gateway/platforms/api_server.py).
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const rate = await checkRateLimitForOrg({
    headers: req.headers,
    routeKey: 'ai-chat',
    limit: Number(process.env.AI_CHAT_RATE_LIMIT || 25),
    windowMs: 60 * 1000,
    organizationId: ctx.organizationId,
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
    const body = (await req.json().catch(() => ({}))) as AiChatBody;
    const { sessionId, message } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const trimmedMessage = message.trim();

    // Persist user message (fire-and-forget)
    void persistChatMessage({ organizationId: ctx.organizationId, sessionId, role: 'user', content: trimmedMessage });

    // 1. Shared pre-loop: local_ops short-circuit OR live DB enrichment
    //    (same module as /api/assistant/chat — Sparkles parity).
    const prepared = await enrichAssistantTurn(ctx.organizationId, trimmedMessage);

    if (prepared.kind === 'local_ops') {
      const localResolution = prepared.resolution;
      console.info('[ai-chat] local ops answer', {
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
      void persistChatMessage({ organizationId: ctx.organizationId, sessionId, role: 'assistant', content: localResolution.reply, mode: localResolution.mode, analysis: localResolution.analysis });
      return NextResponse.json(localPayload);
    }

    const intents = prepared.intents.length > 0 ? prepared.intents : detectIntents(trimmedMessage);

    // 2. Bose manual RAG intercept — Hermes-only; routes through rag tunnel
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

          console.info('[ai-chat] Bose RAG answer', {
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
          void persistChatMessage({ organizationId: ctx.organizationId, sessionId, role: 'assistant', content: ragResult.answer, mode: 'rag', analysis });
          return NextResponse.json(ragPayload);
        }
      } catch (ragErr: any) {
        console.warn('[ai-chat] NemoClaw RAG failed (non-fatal), falling through to Hermes:', ragErr?.message);
      }
    }

    const enrichedMessage = prepared.userMessage;

    // 3. Send to local Hermes gateway. Hermes loads our skills (00/10/40),
    // injects business context, and may call our Python tool CLI via its
    // terminal toolset when the query needs fresh Neon data.
    //
    // Session continuity is handled via the X-Hermes-Session-Id header —
    // Hermes persists the conversation in ~/.hermes-usav/state.db so
    // follow-up turns ("and yesterday?") see the prior context.
    const hermesRes = await fetch(`${getHermesApiUrl()}/chat/completions`, {
      method: 'POST',
      headers: getHermesHeaders({
        'Content-Type': 'application/json',
        'X-Hermes-Session-Id': sessionId,
        'X-Source': 'usav',
      }),
      body: JSON.stringify({
        model: getHermesModel(),
        messages: [
          {
            role: 'system',
            content:
              'You are the Cycle Forge operations assistant. Staff ask about ' +
              'orders, stock, staff pace, receiving, and repairs. Keep answers ' +
              'concrete and numeric, 1-4 sentences. Use ISO Pacific dates. ' +
              'Call tools for fresh data.',
          },
          { role: 'user', content: enrichedMessage },
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!hermesRes.ok) {
      const errBody = await hermesRes.text().catch(() => '');
      console.error('[ai-chat] Hermes gateway error:', hermesRes.status, errBody.slice(0, 300));
      return NextResponse.json(
        { error: `Local AI returned ${hermesRes.status}. Is the hermes-gateway PM2 app running?` },
        { status: 502 },
      );
    }

    const data = await hermesRes.json();
    const rawReply =
      data?.choices?.[0]?.message?.content ||
      data?.reply ||
      'No response received.';

    // Strip <think>...</think> reasoning blocks if model includes them
    const reply = rawReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || rawReply;

    console.info('[ai-chat] Hermes answered', {
      model: data?.model ?? 'hermes-agent',
      chars: reply.length,
    });

    // local_ops answers short-circuit above, so this path never carries a
    // local analysis — mode is plain 'assistant'.
    const payload: AiChatRouteResponse = {
      reply: String(reply).trim(),
      sessionId,
      mode: 'assistant',
      analysis: null,
    };
    void persistChatMessage({ organizationId: ctx.organizationId, sessionId, role: 'assistant', content: String(reply).trim(), mode: 'assistant' });
    return NextResponse.json(payload);
  } catch (err: any) {
    console.error('[ai-chat] Error:', err?.message);
    return NextResponse.json(
      { error: err?.message ?? 'Chat request failed' },
      { status: 503 },
    );
  }
}, { permission: 'dashboard.view', feature: 'aiChat' });
