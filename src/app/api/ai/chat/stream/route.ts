/**
 * AI Chat — STREAMING endpoint (Server-Sent Events).
 *
 * Mirrors the routing logic of ../route.ts (local-ops resolver → Bose RAG →
 * Hermes gateway) but streams the assistant answer token-by-token so the UI
 * can render text as it arrives instead of waiting 60-80s for one blob.
 *
 * Event protocol (text/event-stream), one JSON payload per `data:` line:
 *   event: meta      { mode, sessionId }
 *   event: step      { label }                 // coarse progress hints
 *   event: delta     { text }                  // incremental assistant text
 *   event: analysis  { ...AiStructuredAnswer } // structured card (local/rag/hybrid)
 *   event: error     { message }
 *   event: done      { mode }
 *
 * Instant/structured modes (local_ops, rag) don't stream from the model — we
 * emit their full text as a single delta followed by the analysis + done.
 */
import { NextRequest } from 'next/server';
import { buildContextBlock } from '@/lib/ai/context-fetchers';
import { detectIntents, extractParams } from '@/lib/ai/intent-router';
import { formatAnalysisForPrompt, resolveLocalAiAnswer } from '@/lib/ai/ops-assistant';
import { queryNemoClawRag } from '@/lib/ai/nemoclaw-rag';
import { checkRateLimit } from '@/lib/api-guard';
import { persistChatMessage } from '@/lib/ai/chat-persistence';
import type { AiStructuredAnswer } from '@/lib/ai/types';
import { withAuth } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

type AiChatBody = { sessionId?: string; message?: string };

const HERMES_API_URL = process.env.HERMES_API_URL || 'http://127.0.0.1:8642/v1';
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';

const encoder = new TextEncoder();
function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Incremental `<think>…</think>` stripper. The model may interleave reasoning
 * blocks; we never want those in the visible answer. Handles tags split across
 * stream chunks by retaining a small tail when a partial tag is possible.
 */
function createThinkStripper() {
  let inside = false;
  let carry = '';
  const OPEN = '<think>';
  const CLOSE = '</think>';
  return (chunk: string): string => {
    let buf = carry + chunk;
    carry = '';
    let out = '';
    while (buf.length > 0) {
      if (!inside) {
        const open = buf.indexOf(OPEN);
        if (open === -1) {
          // keep a tail that could be the start of an OPEN tag split mid-chunk
          const keep = Math.max(0, buf.length - (OPEN.length - 1));
          out += buf.slice(0, keep);
          carry = buf.slice(keep);
          break;
        }
        out += buf.slice(0, open);
        buf = buf.slice(open + OPEN.length);
        inside = true;
      } else {
        const close = buf.indexOf(CLOSE);
        if (close === -1) {
          const keep = Math.max(0, buf.length - (CLOSE.length - 1));
          carry = buf.slice(keep);
          break;
        }
        buf = buf.slice(close + CLOSE.length);
        inside = false;
      }
    }
    return out;
  };
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const rate = checkRateLimit({
    headers: req.headers,
    routeKey: 'ai-chat',
    limit: Number(process.env.AI_CHAT_RATE_LIMIT || 25),
    windowMs: 60 * 1000,
  });
  if (!rate.ok) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = (await req.json().catch(() => ({}))) as AiChatBody;
  const sessionId = body.sessionId;
  const message = body.message;
  if (!sessionId || typeof sessionId !== 'string') {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const trimmedMessage = message.trim();
  const organizationId = ctx.organizationId;
  void persistChatMessage({ organizationId, sessionId, role: 'user', content: trimmedMessage });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(sse(event, data));
      // keep-alive comments so proxies don't drop a long idle connection
      const keepAlive = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { /* closed */ }
      }, 15_000);

      try {
        // 1. Deterministic local-ops resolution (instant, no model)
        send('step', { label: 'Checking local ops data' });
        const localResolution = await resolveLocalAiAnswer(trimmedMessage);

        if (localResolution?.mode === 'local_ops') {
          send('meta', { mode: 'local_ops', sessionId });
          send('delta', { text: localResolution.reply });
          send('analysis', localResolution.analysis);
          send('done', { mode: 'local_ops' });
          void persistChatMessage({ organizationId, sessionId, role: 'assistant', content: localResolution.reply, mode: 'local_ops', analysis: localResolution.analysis });
          return;
        }

        const intents = detectIntents(trimmedMessage);
        const params = extractParams(trimmedMessage, intents);

        // 2. Bose manual RAG intercept
        if (intents.includes('bose_manual')) {
          send('step', { label: 'Searching Bose service manuals' });
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
                sources: ragResult.sources.map((src, i) => ({ id: `rag-src-${i}`, label: src, detail: `Source: ${src}` })),
                followUps: [
                  'What parts are needed for this repair?',
                  'Show the wiring diagram for this model',
                  'What are the specs for this speaker?',
                  'Are there known issues with this model?',
                ],
              };
              send('meta', { mode: 'rag', sessionId });
              send('delta', { text: ragResult.answer });
              send('analysis', analysis);
              send('done', { mode: 'rag' });
              void persistChatMessage({ organizationId, sessionId, role: 'assistant', content: ragResult.answer, mode: 'rag', analysis });
              return;
            }
          } catch {
            // non-fatal — fall through to Hermes
          }
        }

        // 3. Enrich with live DB context, then stream from the Hermes gateway
        let enrichedMessage = trimmedMessage;
        if (localResolution?.analysis) {
          enrichedMessage = `[Structured USAV ops data]\n${formatAnalysisForPrompt(localResolution.analysis)}\n\nUser question: ${trimmedMessage}`;
        }
        if (intents.length > 0) {
          try {
            send('step', { label: 'Pulling live warehouse data' });
            const contextBlock = await buildContextBlock(intents, params);
            if (contextBlock) {
              enrichedMessage =
                `[Live USAV data - ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST]\n` +
                contextBlock + `\n\nUser question: ${trimmedMessage}`;
            }
          } catch { /* non-fatal */ }
        }

        send('meta', { mode: localResolution?.analysis ? 'hybrid' : 'assistant', sessionId });
        send('step', { label: 'Asking the assistant' });

        const hermesRes = await fetch(`${HERMES_API_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(HERMES_API_KEY && { Authorization: `Bearer ${HERMES_API_KEY}` }),
            'X-Hermes-Session-Id': sessionId,
            'X-Source': 'usav',
          },
          body: JSON.stringify({
            model: process.env.HERMES_MODEL || 'hermes-agent',
            messages: [
              {
                role: 'system',
                content:
                  'You are the USAV Ops Assistant embedded in the operations app. ' +
                  'Staff at a 5-person shop ask about orders, stock, staff pace, ' +
                  'receiving, and repairs. Keep answers concrete and numeric, 1-4 ' +
                  'sentences. Use ISO Pacific dates. Call tools for fresh data. ' +
                  'When you list multiple records (orders, shipments, repairs, SKUs), ' +
                  'do NOT write a long run-on paragraph — output a compact GitHub-' +
                  'flavored Markdown table, one record per row, with short columns ' +
                  '(e.g. Order | Product | Date | Status). Put each order or tracking ' +
                  'ID in its own cell verbatim so it can be linked. Lead with a one-' +
                  'line count, then the table.',
              },
              { role: 'user', content: enrichedMessage },
            ],
            stream: true,
            temperature: 0.3,
            max_tokens: 2048,
          }),
          signal: AbortSignal.timeout(180_000),
        });

        if (!hermesRes.ok || !hermesRes.body) {
          const errBody = await hermesRes.text().catch(() => '');
          console.error('[ai-chat-stream] Hermes error:', hermesRes.status, errBody.slice(0, 300));
          send('error', { message: `Local AI returned ${hermesRes.status}. Is the hermes gateway running?` });
          send('done', { mode: 'assistant' });
          return;
        }

        const strip = createThinkStripper();
        const reader = hermesRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assembled = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const piece: string = json?.choices?.[0]?.delta?.content || '';
              if (!piece) continue;
              const visible = strip(piece);
              if (visible) {
                assembled += visible;
                send('delta', { text: visible });
              }
            } catch { /* ignore non-JSON keep-alives */ }
          }
        }

        const finalText = assembled.trim();
        const finalMode = localResolution?.analysis ? 'hybrid' : 'assistant';
        if (localResolution?.analysis) send('analysis', localResolution.analysis);
        send('done', { mode: finalMode });
        void persistChatMessage({
          organizationId, sessionId, role: 'assistant',
          content: finalText || 'No response received.',
          mode: finalMode,
          analysis: localResolution?.analysis ?? null,
        });
      } catch (err: unknown) {
        const messageText = err instanceof Error ? err.message : 'Chat request failed';
        console.error('[ai-chat-stream] error:', messageText);
        try { send('error', { message: messageText }); send('done', { mode: 'assistant' }); } catch { /* closed */ }
      } finally {
        clearInterval(keepAlive);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}, { permission: 'dashboard.view' });
