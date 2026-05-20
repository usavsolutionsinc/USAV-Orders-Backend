/**
 * POST /api/auth/signup
 *
 * Self-service tenant provisioning. Creates an organization, the first
 * admin staff, hashes their PIN, opens a session, and (best-effort) sends
 * a welcome email + creates a Stripe customer for the 14-day trial.
 *
 * Public (no session required, no permission). Throttled by IP because
 * this is a free-tier creation endpoint and we don't want it spammed.
 *
 * Body:
 *   { companyName: string, slug?: string, fullName: string, email: string,
 *     pin: string (4-12 digits) }
 *
 * Response: sets the usav_sid cookie and returns { orgId, slug, staffId,
 *           defaultHomePath: '/dashboard' }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimitAsync } from '@/lib/api-guard';
import { createSession, SESSION_COOKIE_NAME, getCookieMaxAgeSeconds } from '@/lib/auth/session';
import { hashPin, isObviousPin } from '@/lib/auth/pin';
import { createOrganization, getOrganizationBySlug } from '@/lib/tenancy/organizations';
import { sendEmailBestEffort } from '@/lib/email/send';
import { createStripeCustomer } from '@/lib/billing/stripe';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
const SignupSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(SLUG_RE).optional(),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  pin: z.string().regex(/^\d{4,12}$/),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let n = 0; n < 50; n++) {
    const existing = await getOrganizationBySlug(candidate);
    if (!existing) return candidate;
    candidate = `${base}-${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  throw new Error('Could not allocate a unique workspace slug');
}

export const POST = withAuth(async (req: NextRequest) => {
  // Light IP throttle — 5 signups / 10 min per IP. Stops trivial abuse.
  const limited = await checkRateLimitAsync({
    headers: req.headers,
    routeKey: 'auth-signup',
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfterSec: limited.retryAfterSec },
      { status: 429 },
    );
  }

  let parsed: z.infer<typeof SignupSchema>;
  try {
    parsed = SignupSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400 },
    );
  }

  if (isObviousPin(parsed.pin)) {
    return NextResponse.json({ error: 'WEAK_PIN' }, { status: 400 });
  }

  const slug = await uniqueSlug(parsed.slug ?? slugify(parsed.companyName));

  const client = await pool.connect();
  let staffId: number;
  let orgId: string;
  try {
    await client.query('BEGIN');

    // 1. Org
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (slug, name, plan, status, trial_ends_at, settings)
       VALUES ($1, $2, 'trial', 'active', now() + interval '14 days', '{}'::jsonb)
       RETURNING id`,
      [slug, parsed.companyName],
    );
    orgId = orgRes.rows[0]!.id;

    // 2. First admin staff
    const pinHash = await hashPin(parsed.pin);
    const staffRes = await client.query<{ id: number }>(
      `INSERT INTO staff
         (name, role, active, organization_id, pin_hash, pin_set_at, status, default_home_path)
       VALUES ($1, 'admin', true, $2, $3, now(), 'active', '/dashboard')
       RETURNING id`,
      [parsed.fullName, orgId, pinHash],
    );
    staffId = staffRes.rows[0]!.id;

    // 3. Wire to the admin role (if the roles taxonomy exists in this DB)
    await client.query(
      `INSERT INTO staff_roles (staff_id, role_id)
       SELECT $1, r.id FROM roles r WHERE r.key = 'admin'
       ON CONFLICT DO NOTHING`,
      [staffId],
    );

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow */ }
    console.error('[signup] db error:', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  // 4. Mint the session for the new admin
  const session = await createSession({
    staffId,
    deviceKind: 'personal',
    deviceLabel: 'signup',
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: req.headers.get('user-agent'),
  });

  // 5. Side-effects (best-effort, must not break the signup)
  void sendEmailBestEffort({
    to: parsed.email,
    subject: `Welcome to ${parsed.companyName}`,
    text:
      `Hi ${parsed.fullName},\n\n` +
      `Your workspace "${parsed.companyName}" is ready. Your URL is:\n` +
      `  ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.example.com'}/dashboard\n\n` +
      `You're on a 14-day trial. Invite teammates from the admin panel.\n`,
  });

  if (process.env.STRIPE_SECRET_KEY) {
    // Provision the Stripe customer up front so the first upgrade attempt
    // doesn't have to wait on a round-trip. Best effort — billing still
    // works if this fails.
    createStripeCustomer({
      email: parsed.email,
      name: parsed.companyName,
      metadata: { organization_id: orgId, slug },
    })
      .then(async ({ id }) => {
        await pool.query(
          `UPDATE organizations SET stripe_customer_id = $1, updated_at = now() WHERE id = $2`,
          [id, orgId],
        );
      })
      .catch((err) => console.warn('[signup] stripe customer create failed:', err));
  }

  const res = NextResponse.json({
    orgId,
    slug,
    staffId,
    defaultHomePath: '/dashboard',
  });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.sid,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: getCookieMaxAgeSeconds('personal'),
  });
  return res;
}, { allowAnonymous: true });
