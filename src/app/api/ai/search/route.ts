import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api-guard';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

export const runtime = 'nodejs';

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const OPENCLAW_USAV_TOKEN = process.env.OPENCLAW_USAV_TOKEN || '';

type SearchRequestBody = {
  page?: string;
  query?: string;
  context?: Record<string, unknown>;
};

const SEARCH_SCHEMA_HINT = {
  answer: 'string',
  matches: ['short bullet of likely matching record or area'],
  followUpQuestions: ['question'],
  confidence: 'low | medium | high',
};

function getSystemPrompt() {
  return [
    'You are a contextual search assistant for an operations dashboard.',
    'Use only provided context data. Do not invent records.',
    'Return strict JSON only with keys: answer, matches, followUpQuestions, confidence.',
  ].join(' ');
}

export async function POST(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const rate = checkRateLimit({
      headers: req.headers,
      routeKey: 'ai-search',
      limit: Number(process.env.AI_SEARCH_RATE_LIMIT || 40),
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

    const body = (await req.json().catch(() => ({}))) as SearchRequestBody;
    const query = String(body.query || '').trim();

    if (!query) {
      return NextResponse.json({ error: 'Missing search query' }, { status: 400 });
    }

    if (!OPENCLAW_GATEWAY_URL) {
      return NextResponse.json({ error: 'OPENCLAW_GATEWAY_URL not configured' }, { status: 503 });
    }

    const res = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_USAV_TOKEN}`,
        'X-Source': 'usav',
      },
      body: JSON.stringify({
        model: 'openclaw/usav-ops',
        messages: [
          { role: 'system', content: getSystemPrompt() },
          {
            role: 'user',
            content: `Page: ${body.page || 'unknown'}\nQuery: ${query}\nContext:\n${JSON.stringify(
              body.context || {},
              null,
              2
            )}\n\nRequired schema:\n${JSON.stringify(SEARCH_SCHEMA_HINT, null, 2)}`,
          },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `AI search backend error (${res.status})`, details: errText.slice(0, 200) },
        { status: 502 },
      );
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {
        answer: content,
        matches: [],
        followUpQuestions: [],
        confidence: 'low',
      };
    }

    return NextResponse.json({
      ok: true,
      model: data?.model ?? 'openclaw/usav-ops',
      result: parsed,
    });
  } catch (error: any) {
    console.error('AI search failed:', error);
    return NextResponse.json(
      { error: 'AI search request failed', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
