/**
 * POST /api/support/suggest — draft an AI support reply for a Zendesk ticket.
 *
 * Local-model lane: grounds the customer's question in the Bose document RAG
 * (NemoClaw) and composes a reply with the local Hermes gateway. Returns the
 * draft + sources + confidence; the agent accepts/edits/sends it from the
 * support console. This is a generation (no state mutation), so — like
 * /api/ai/chat — it does not write an audit row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimit } from '@/lib/api-guard';
import { suggestSupportReply, SupportSuggestError } from '@/lib/support/suggest-reply';

export const runtime = 'nodejs';

type SuggestBody = { ticketId?: number; subject?: string; question?: string };

export const POST = withAuth(async (req: NextRequest) => {
  const rate = checkRateLimit({
    headers: req.headers,
    routeKey: 'support-suggest',
    limit: Number(process.env.AI_CHAT_RATE_LIMIT || 25),
    windowMs: 60 * 1000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again shortly.' },
      { status: 429, headers: rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : undefined },
    );
  }

  const body = (await req.json().catch(() => ({}))) as SuggestBody;
  const ticketId = Number(body.ticketId);
  const question = typeof body.question === 'string' ? body.question.trim() : '';

  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  try {
    const result = await suggestSupportReply({
      ticketId,
      subject: typeof body.subject === 'string' ? body.subject : undefined,
      question,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof SupportSuggestError) {
      console.error('[support/suggest]', err.status, err.message, err.detail ?? '');
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[support/suggest] unexpected', (err as Error)?.message);
    return NextResponse.json({ error: 'Suggestion failed' }, { status: 503 });
  }
}, { permission: 'integrations.zendesk' });
