import { NextRequest, NextResponse } from 'next/server';
import { chatWithOllama } from '@/lib/ai/ollama';
import { checkRateLimit } from '@/lib/api-guard';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

export const runtime = 'nodejs';

type SearchRequestBody = {
  page?: string;
  query?: string;
  context?: Record<string, unknown>;
  model?: string;
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

    const result = await chatWithOllama({
      model: body.model,
      format: 'json',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: getSystemPrompt(),
        },
        {
          role: 'user',
          content: `Page: ${body.page || 'unknown'}\nQuery: ${query}\nContext:\n${JSON.stringify(
            body.context || {},
            null,
            2
          )}\n\nRequired schema:\n${JSON.stringify(SEARCH_SCHEMA_HINT, null, 2)}`,
        },
      ],
    });

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      parsed = {
        answer: result.content,
        matches: [],
        followUpQuestions: [],
        confidence: 'low',
      };
    }

    return NextResponse.json({
      ok: true,
      model: result.model,
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
