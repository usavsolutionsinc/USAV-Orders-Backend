/**
 * GET /api/auth/email-login/verify?token=…
 *
 * Phase F1 — consumes a magic-link token (single-use, 15-min) and, if valid,
 * mints a session + redirects to the dashboard. The token is claimed ATOMICALLY
 * (UPDATE … SET used_at WHERE unused AND unexpired RETURNING) so a replay or a
 * double-click can't mint two sessions. On any failure it redirects to the home
 * page with a ?login_error reason (never leaks token state in the body).
 *
 * Public (no session). Pair: POST /api/auth/email-login/request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import {
  createSession,
  SESSION_COOKIE_NAME,
  cookieMaxAgeForSession,
} from '@/lib/auth/session';

export const GET = withAuth(async (req: NextRequest) => {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
  const fail = (reason: string) =>
    NextResponse.redirect(`${base || ''}/?login_error=${reason}`);

  const token = req.nextUrl.searchParams.get('token') ?? '';
  if (!token) return fail('missing');

  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Atomically claim: succeeds (and returns staff_id) only if the token is
  // unused and unexpired; flips used_at so it can never be replayed.
  const claimed = await pool.query<{ staff_id: number }>(
    `UPDATE email_login_tokens
        SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING staff_id`,
    [tokenHash],
  );
  const staffId = claimed.rows[0]?.staff_id;
  if (!staffId) return fail('invalid');

  const session = await createSession({
    staffId,
    deviceKind: 'personal',
    deviceLabel: 'email-login',
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: req.headers.get('user-agent'),
  });

  const res = NextResponse.redirect(`${base || ''}/dashboard`);
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
