/**
 * /api/auth/invitation/accept  (PUBLIC — invitee is not yet authenticated)
 *
 *   GET  ?token=…  — preview an invitation (org name, email, role) for the
 *                    accept page. Does not consume the token.
 *   POST {token, name, password}
 *                  — accept: find-or-create account, membership, staff profile,
 *                    then sign the user in (mint a session + set the cookie).
 *
 * Under /api/auth/ so it matches the PUBLIC_PATHS allowlist in src/proxy.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createSession,
  cookieMaxAgeForSession,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';
import {
  previewInvitation,
  acceptInvitation,
  InvitationError,
} from '@/lib/identity/invitations';
import { PasswordError } from '@/lib/identity/password';
import { logAuthEvent } from '@/lib/identity/memberships';

export const runtime = 'nodejs';

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip') || null;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  if (!token) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const preview = await previewInvitation(token);
  if (preview.status !== 'valid') {
    return NextResponse.json({ status: preview.status }, { status: 404 });
  }
  return NextResponse.json({
    status: 'valid',
    organizationName: preview.orgName,
    email: preview.email,
    role: preview.roleKey,
  });
}

const Body = z.object({
  token: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent');

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await acceptInvitation({
      token: parsed.token,
      name: parsed.name,
      password: parsed.password,
    });
  } catch (err) {
    if (err instanceof InvitationError) {
      const status =
        err.code === 'NOT_FOUND' ? 404 :
        err.code === 'EXPIRED' || err.code === 'ALREADY_ACCEPTED' ? 410 :
        err.code === 'PASSWORD_MISMATCH' ? 401 :
        400;
      return NextResponse.json({ error: err.code }, { status });
    }
    if (err instanceof PasswordError) {
      return NextResponse.json({ error: 'WEAK_PASSWORD', code: err.code }, { status: 400 });
    }
    console.error('[/api/auth/invitation/accept] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }

  // Sign the new member in: mint a personal-device session for their profile.
  const session = await createSession({
    staffId: result.staffId,
    deviceKind: 'personal',
    ip,
    userAgent: ua,
  });

  await audit({
    staffId: result.staffId, sid: session.sid,
    event: 'signin.invitation_accept', result: 'ok', ip, userAgent: ua,
    detail: { accountId: result.accountId, orgId: result.orgId },
  });
  await logAuthEvent({ accountId: result.accountId, orgId: result.orgId, event: 'invite_accept', ip, userAgent: ua });

  const res = NextResponse.json({ ok: true, organizationId: result.orgId });
  res.cookies.set(SESSION_COOKIE_NAME, session.sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: cookieMaxAgeForSession(session),
  });
  return res;
}
