/**
 * POST /api/beta/waitlist
 *
 * Lightweight, PUBLIC beta-waitlist capture for the marketing site
 * (CycleForge). No auth, no $50 deposit, no Stripe — just an email + a
 * "wants the video preview" interest flag. Upserts on lower(email) so a
 * repeat submit refreshes company/utm/wants_video instead of erroring.
 *
 * Cross-origin: the marketing site lives on a different origin, so this
 * route answers CORS preflight (OPTIONS) and stamps CORS headers on the
 * POST response. Allowed origin = MARKETING_ORIGIN (default
 * https://cycleforge.com) + http://localhost:3001 in dev.
 *
 * Body: { email, companyName?, source?, wantsVideo?, utm? }
 * Response: { ok: true }   (429 on rate limit, 400 on bad input)
 *
 * IP-throttled (~5 / 10 min) — mirrors /api/auth/signup. Public/pre-auth, so
 * IP-only via checkRateLimitAsync.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { checkRateLimitAsync } from '@/lib/api-guard';
import { sendEmailBestEffort } from '@/lib/email/send';

const WaitlistSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  companyName: z.string().trim().max(160).optional(),
  source: z.string().trim().max(80).optional(),
  wantsVideo: z.boolean().optional(),
  utm: z.record(z.string(), z.string()).optional(),
});

// ── CORS ────────────────────────────────────────────────────────────────────
function allowedOrigins(): string[] {
  const marketing = process.env.MARKETING_ORIGIN || 'https://cycleforge.com';
  const origins = [marketing];
  if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:3001');
  return origins;
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  const allowed = allowedOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0]!;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);

  // Light IP throttle — 5 / 10 min per IP. Stops trivial abuse.
  const limited = await checkRateLimitAsync({
    headers: req.headers,
    routeKey: 'beta-waitlist',
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfterSec: limited.retryAfterSec },
      { status: 429, headers: cors },
    );
  }

  let parsed: z.infer<typeof WaitlistSchema>;
  try {
    parsed = WaitlistSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400, headers: cors },
    );
  }

  try {
    // Upsert on lower(email): a repeat submit refreshes the soft fields but
    // never demotes status (an already-invited/converted lead stays so).
    await pool.query(
      `INSERT INTO beta_waitlist (email, company_name, source, utm, wants_video)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (lower(email)) DO UPDATE SET
         company_name = COALESCE(EXCLUDED.company_name, beta_waitlist.company_name),
         source       = COALESCE(EXCLUDED.source, beta_waitlist.source),
         utm          = EXCLUDED.utm,
         wants_video  = EXCLUDED.wants_video`,
      [
        parsed.email,
        parsed.companyName ?? null,
        parsed.source ?? null,
        JSON.stringify(parsed.utm ?? {}),
        parsed.wantsVideo ?? false,
      ],
    );
  } catch (err) {
    console.error('[beta-waitlist] db error:', err);
    return NextResponse.json(
      { error: 'INTERNAL' },
      { status: 500, headers: cors },
    );
  }

  // Best-effort confirmation email — never blocks the response.
  void sendEmailBestEffort({
    to: parsed.email,
    subject: "You're on the CycleForge beta waitlist",
    text:
      `Thanks for your interest in the CycleForge beta.\n\n` +
      `You're on the waitlist — we'll be in touch as spots open up` +
      `${parsed.wantsVideo ? ', including early access to the product video preview' : ''}.\n`,
  });

  return NextResponse.json({ ok: true }, { headers: cors });
}
