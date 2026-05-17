/**
 * POST /api/auth/signout
 *
 * Revokes the current session and clears the cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revokeSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';

export const runtime = 'nodejs';

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip') || null;
}

export async function POST(req: NextRequest) {
  const sid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (sid) {
    await revokeSession(sid);
    await audit({
      sid, event: 'signout', result: 'ok',
      ip: clientIp(req), userAgent: req.headers.get('user-agent'),
    });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
