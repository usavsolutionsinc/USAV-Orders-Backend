/**
 * POST /api/auth/email-login/request
 *
 * Phase F1 — passwordless owner login. Body: { email }. Looks the email up across
 * orgs (pre-session, owner pool), and if it matches an active staffer, emails a
 * one-time magic link (15-min, hashed token). ALWAYS returns { ok: true } — it
 * must not reveal whether an email is registered. IP-throttled.
 *
 * Public (no session). Pair: GET /api/auth/email-login/verify.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimitAsync } from '@/lib/api-guard';
import { sendEmailBestEffort } from '@/lib/email/send';

const Schema = z.object({ email: z.string().trim().toLowerCase().email() });

export const POST = withAuth(async (req: NextRequest) => {
  const limited = await checkRateLimitAsync({
    headers: req.headers,
    routeKey: 'auth-email-login',
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfterSec: limited.retryAfterSec },
      { status: 429 },
    );
  }

  let email: string;
  try {
    email = Schema.parse(await req.json()).email;
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  // Cross-org email lookup (owner pool, pre-session). If two orgs share an email,
  // LIMIT 1 picks one — multi-org disambiguation is a later refinement.
  const staffR = await pool.query<{ id: number; organization_id: string; name: string }>(
    `SELECT id, organization_id, name
       FROM staff
      WHERE lower(email) = $1 AND active = true AND status = 'active'
      LIMIT 1`,
    [email],
  );
  const staff = staffR.rows[0];

  if (staff) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await pool.query(
      `INSERT INTO email_login_tokens (organization_id, staff_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '15 minutes')`,
      [staff.organization_id, staff.id, tokenHash],
    );
    const base =
      process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.example.com';
    const link = `${base}/api/auth/email-login/verify?token=${token}`;
    void sendEmailBestEffort({
      to: email,
      subject: 'Your sign-in link',
      text:
        `Hi ${staff.name},\n\n` +
        `Click to sign in (valid 15 minutes, one-time use):\n  ${link}\n\n` +
        `If you didn't request this, you can safely ignore this email.\n`,
    });
  }

  // Constant response regardless of whether the email exists.
  return NextResponse.json({ ok: true });
}, { allowAnonymous: true });
