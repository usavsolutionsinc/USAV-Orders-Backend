/**
 * POST /api/auth/account/passkey/register/finish
 *
 * Body: { response: RegistrationResponseJSON, label?: string }
 *
 * Verifies the attestation against the challenge cookie set by /begin and
 * stores the credential on the account. Does not sign anyone in.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAccountRegistration,
  insertAccountPasskey,
  ACCOUNT_PASSKEY_CHALLENGE_COOKIE,
} from '@/lib/identity/webauthn-account';
import { getCurrentUser } from '@/lib/auth/current-user';
import { resolveAccountIdForStaff, logAuthEvent } from '@/lib/identity/memberships';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';

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
    const response = (body as { response?: unknown }).response as RegistrationResponseJSON | undefined;
    const label = ((body as { label?: unknown }).label ?? null) as string | null;
    if (!response) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });

    const cookie = req.cookies.get(ACCOUNT_PASSKEY_CHALLENGE_COOKIE)?.value;
    if (!cookie) return NextResponse.json({ error: 'CHALLENGE_MISSING' }, { status: 400 });
    let challenge: string;
    try {
      challenge = (JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as { challenge: string }).challenge;
    } catch {
      return NextResponse.json({ error: 'CHALLENGE_INVALID' }, { status: 400 });
    }

    // Derive the account from the live SESSION, not the cookie — so a crafted
    // cookie can't attach a passkey to someone else's account. (The cookie is
    // only trusted for the challenge, which the attestation is bound to anyway.)
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    const accountId = await resolveAccountIdForStaff(me.staffId);
    if (!accountId) return NextResponse.json({ error: 'MULTI_ORG_NOT_PROVISIONED' }, { status: 409 });

    const verification = await verifyAccountRegistration({ req, expectedChallenge: challenge, response });
    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'VERIFY_FAILED' }, { status: 400 });
    }

    const info = verification.registrationInfo;
    await insertAccountPasskey({
      accountId,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
      signCount: info.credential.counter,
      transports: info.credential.transports,
      aaguid: info.aaguid && info.aaguid !== '00000000-0000-0000-0000-000000000000' ? info.aaguid : null,
      label,
    });

    await logAuthEvent({ accountId, orgId: null, event: 'passkey_register', ip, userAgent: ua });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(ACCOUNT_PASSKEY_CHALLENGE_COOKIE, '', {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 0,
    });
    return res;
  } catch (err) {
    console.error('[account/passkey/register/finish] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
