/**
 * POST /api/auth/account/passkey/authenticate/finish  (PUBLIC)
 *
 * Body: { response: AuthenticationResponseJSON, organizationId? }
 *
 * Verifies the assertion → resolves the account → its memberships → mints a
 * session for one workspace. The challenge is single-use, so we can't pause for
 * an org picker the way password login does; we sign into `organizationId` if
 * supplied, else the first membership (alphabetical) — the user can switch from
 * Settings → Organization afterward.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  verifyAccountAuthentication,
  bumpAccountPasskeyCounter,
  ACCOUNT_PASSKEY_CHALLENGE_COOKIE,
} from '@/lib/identity/webauthn-account';
import {
  createSession,
  cookieMaxAgeForSession,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';
import { listMembershipsForAccount, logAuthEvent } from '@/lib/identity/memberships';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';

export const runtime = 'nodejs';

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip') || null;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent');

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const response = (body as { response?: unknown }).response as AuthenticationResponseJSON | undefined;
    const organizationId = (body as { organizationId?: unknown }).organizationId as string | undefined;
    if (!response) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });

    const cookie = req.cookies.get(ACCOUNT_PASSKEY_CHALLENGE_COOKIE)?.value;
    if (!cookie) return NextResponse.json({ error: 'CHALLENGE_MISSING' }, { status: 400 });
    let challenge: string;
    try {
      challenge = (JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as { challenge: string }).challenge;
    } catch {
      return NextResponse.json({ error: 'CHALLENGE_INVALID' }, { status: 400 });
    }

    const result = await verifyAccountAuthentication({ req, expectedChallenge: challenge, response });
    if (!result.verified || !result.passkey || !result.info) {
      return NextResponse.json({ error: 'VERIFY_FAILED' }, { status: 401 });
    }
    const accountId = result.passkey.account_id;
    await bumpAccountPasskeyCounter(result.passkey.id, result.info.newCounter);

    // Account must still be active.
    const a = await pool.query<{ status: string }>(`SELECT status FROM accounts WHERE id = $1 LIMIT 1`, [accountId]);
    if (!a.rows[0] || a.rows[0].status !== 'active') {
      return NextResponse.json({ error: 'ACCOUNT_NOT_ACTIVE' }, { status: 403 });
    }

    const memberships = await listMembershipsForAccount(accountId);
    if (memberships.length === 0) {
      return NextResponse.json({ error: 'NO_WORKSPACE' }, { status: 403 });
    }
    let target = memberships[0]!;
    if (organizationId) {
      const match = memberships.find((m) => m.organization_id === organizationId);
      if (!match) return NextResponse.json({ error: 'NOT_A_MEMBER' }, { status: 403 });
      target = match;
    }

    const session = await createSession({
      staffId: target.staff_id,
      deviceKind: 'personal',
      ip,
      userAgent: ua,
    });

    void pool.query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [accountId]).catch(() => {});

    await audit({
      staffId: target.staff_id, sid: session.sid,
      event: 'signin.account_passkey', result: 'ok', ip, userAgent: ua,
      detail: { accountId, orgId: target.organization_id, passkeyId: result.passkey.id },
    });
    await logAuthEvent({ accountId, orgId: target.organization_id, event: 'login', ip, userAgent: ua });

    const res = NextResponse.json({
      ok: true,
      organizationId: target.organization_id,
      workspaces: memberships.length,
    });
    res.cookies.set(SESSION_COOKIE_NAME, session.sid, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: cookieMaxAgeForSession(session),
    });
    res.cookies.set(ACCOUNT_PASSKEY_CHALLENGE_COOKIE, '', {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 0,
    });
    return res;
  } catch (err) {
    console.error('[account/passkey/authenticate/finish] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
