/**
 * GET /api/auth/verify-email?token=…
 *
 * WS6.3 — consumes an email-verification token (single-use, hashed; minted at
 * signup, see src/lib/auth/email-verification.ts). On a valid token it:
 *   1. atomically claims the token (UPDATE … SET used_at WHERE unused & unexpired
 *      RETURNING) so a replay / double-click can't re-run it,
 *   2. marks the staff's account email verified (`account_emails.verified_at`),
 *   3. mints a session so the link doubles as a cross-device sign-in (same
 *      magic-link UX as /api/auth/email-login/verify).
 *
 * Reuses the F1 `email_login_tokens` store + claim mechanism — no new table.
 * On any failure it redirects home with a ?verify_error reason (never leaks token
 * state in the body). Public (no session required).
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import {
  createSession,
  SESSION_COOKIE_NAME,
  cookieMaxAgeForSession,
} from '@/lib/auth/session';
import { hashVerificationToken } from '@/lib/auth/email-verification';

export const GET = withAuth(async (req: NextRequest) => {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
  const fail = (reason: string) =>
    NextResponse.redirect(`${base || ''}/?verify_error=${reason}`);

  const token = req.nextUrl.searchParams.get('token') ?? '';
  if (!token) return fail('missing');

  const tokenHash = hashVerificationToken(token);

  // Atomically claim: succeeds only if unused + unexpired; flips used_at so it
  // can never be replayed.
  const claimed = await pool.query<{ staff_id: number }>(
    `UPDATE email_login_tokens
        SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING staff_id`,
    [tokenHash],
  );
  const staffId = claimed.rows[0]?.staff_id;
  if (!staffId) return fail('invalid');

  // Mark the staff's account email verified (idempotent). Best-effort: a verified
  // flag write must not break the sign-in / redirect.
  try {
    await pool.query(
      `UPDATE account_emails ae
          SET verified_at = COALESCE(ae.verified_at, now())
         FROM staff s
        WHERE s.id = $1
          AND s.account_id = ae.account_id
          AND lower(ae.email) = lower(s.email)`,
      [staffId],
    );
  } catch (err) {
    console.error('[verify-email] failed to mark account email verified', err);
  }

  // Mint a session so the verify link also signs the owner in (magic-link UX).
  const session = await createSession({
    staffId,
    deviceKind: 'personal',
    deviceLabel: 'verify-email',
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: req.headers.get('user-agent'),
  });

  const res = NextResponse.redirect(`${base || ''}/dashboard?email_verified=1`);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.sid,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: cookieMaxAgeForSession(session),
  });
  return res;
}, { allowAnonymous: true });
