/**
 * POST /api/beta/apply
 *
 * PUBLIC $50-refundable beta application intake for the marketing site
 * (CycleForge) — docs/todo/beta-intake-funnel-plan.md §6, P-1a. Mirrors
 * /api/beta/waitlist's posture exactly: no auth wrapper and no audit call
 * (pre-tenant rows, no org — both need a session ctx), CORS-restricted to
 * MARKETING_ORIGIN, IP-throttled via checkRateLimitAsync, honeypot-guarded.
 * Already covered by the /^\/api\/beta\// PUBLIC_PATHS entry in src/proxy.ts.
 *
 * Body: { email, companyName?, tier: 'application' | 'waitlist', answers,
 *         website? (honeypot) } — validated by BetaApplySchema
 *         (src/lib/beta/apply-schema.ts, the ontology question set).
 *
 * Dedupe: upserts on lower(email) — a re-apply is an idempotent 200 that
 * refreshes answers, never a duplicate row or an error. A waitlist re-submit
 * never demotes an existing application row (tier or answers).
 *
 * Response: { ok: true, applicationId, status, paymentLinkUrl } — the Stripe
 * Payment Link is the env-configured BETA_APPLY_PAYMENT_LINK echoed with
 * client_reference_id=<application id>; no live Stripe call (owner-gated,
 * manual v1 reconcile per plan §7). null for waitlist tier / unconfigured.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkRateLimitAsync } from '@/lib/api-guard';
import { sendEmailBestEffort } from '@/lib/email/send';
import { BetaApplySchema, buildPaymentLinkUrl, isHoneypotTripped, type BetaApply } from '@/lib/beta/apply-schema';

// ── CORS (same shape as /api/beta/waitlist) ─────────────────────────────────
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

  // IP throttle — 5 / hour per IP (plan §6). Open POST, so IP-only.
  const limited = await checkRateLimitAsync({
    headers: req.headers,
    routeKey: 'beta-apply',
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfterSec: limited.retryAfterSec },
      { status: 429, headers: cors },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT', detail: 'invalid JSON' }, { status: 400, headers: cors });
  }

  // Honeypot BEFORE schema validation — a bot gets an indistinguishable fake
  // 200 (no row, no email) instead of a schema error it could learn from.
  // Shape matches a real success exactly (fake id, null payment link) so the
  // responses can't be told apart.
  if (isHoneypotTripped(body)) {
    return NextResponse.json(
      {
        ok: true,
        applicationId: crypto.randomUUID(),
        status: 'RECEIVED',
        paymentLinkUrl: null,
      },
      { headers: cors },
    );
  }

  const parsed = BetaApplySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 10) },
      { status: 400, headers: cors },
    );
  }
  const app: BetaApply = parsed.data;

  let row: { id: string; status: string; tier: string };
  try {
    // Upsert on lower(email): re-apply is idempotent. A repeat submit
    // refreshes answers; a waitlist submit never demotes an existing
    // application row (tier or answers), and status is never touched here —
    // the pipeline status is owned by the manual review flow.
    const res = await pool.query<{ id: string; status: string; tier: string }>(
      `INSERT INTO beta_applications (email, company_name, tier, answers)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (lower(email)) DO UPDATE SET
         company_name = COALESCE(EXCLUDED.company_name, beta_applications.company_name),
         tier         = CASE WHEN beta_applications.tier = 'application'
                             THEN beta_applications.tier ELSE EXCLUDED.tier END,
         answers      = CASE WHEN beta_applications.tier = 'application' AND EXCLUDED.tier = 'waitlist'
                             THEN beta_applications.answers ELSE EXCLUDED.answers END,
         updated_at   = now()
       RETURNING id, status, tier`,
      [app.email, app.companyName ?? null, app.tier, JSON.stringify(app.answers)],
    );
    row = res.rows[0]!;
  } catch (err) {
    console.error('[beta-apply] db error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500, headers: cors });
  }

  const paymentLinkUrl =
    app.tier === 'application' ? buildPaymentLinkUrl(process.env.BETA_APPLY_PAYMENT_LINK, row.id) : null;

  // Best-effort auto-confirmation email (plan §8.1) — never blocks the response.
  void sendEmailBestEffort({
    to: app.email,
    subject:
      app.tier === 'application'
        ? 'Your CycleForge beta application — floor map incoming'
        : "You're on the CycleForge beta waitlist",
    text:
      app.tier === 'application'
        ? `Thanks for applying to the CycleForge beta.\n\n` +
          `Your floor map is being built — you'll hear from a human within 48 hours.\n\n` +
          `The $50 deposit is fully refundable, any time, no questions, and is credited in full at signup.\n` +
          (paymentLinkUrl ? `\nIf you haven't completed the deposit yet: ${paymentLinkUrl}\n` : '')
        : `Thanks for your interest in the CycleForge beta.\n\n` +
          `You're on the waitlist — we'll be in touch as spots open up.\n`,
  });

  return NextResponse.json(
    { ok: true, applicationId: row.id, status: row.status, paymentLinkUrl },
    { headers: cors },
  );
}
