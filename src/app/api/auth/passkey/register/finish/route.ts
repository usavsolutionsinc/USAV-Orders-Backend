/**
 * POST /api/auth/passkey/register/finish
 *
 * Body: { response: RegistrationResponseJSON, deviceLabel?: string,
 *         enrollmentToken?: string }
 *
 * Verifies the WebAuthn attestation against the challenge cookie set by
 * /register/begin, stores the credential on the staff row.
 *
 * Does NOT sign anyone in. The signin flow with passkey (different route)
 * is /authenticate/{begin,finish}.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  insertPasskey,
  PASSKEY_CHALLENGE_COOKIE,
  verifyRegistration,
} from '@/lib/auth/webauthn';
import { audit } from '@/lib/auth/audit';
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
    const deviceLabel = ((body as { deviceLabel?: unknown }).deviceLabel ?? null) as string | null;

    if (!response) {
      return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    const cookie = req.cookies.get(PASSKEY_CHALLENGE_COOKIE)?.value;
    if (!cookie) {
      return NextResponse.json({ error: 'CHALLENGE_MISSING' }, { status: 400 });
    }
    let challenge: string;
    let staffId: number;
    try {
      const decoded = JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as {
        challenge: string;
        staffId: number;
      };
      challenge = decoded.challenge;
      staffId = decoded.staffId;
    } catch {
      return NextResponse.json({ error: 'CHALLENGE_INVALID' }, { status: 400 });
    }

    const verification = await verifyRegistration({
      req,
      expectedChallenge: challenge,
      response,
    });
    if (!verification.verified || !verification.registrationInfo) {
      await audit({
        staffId, event: 'passkey.register', result: 'denied', ip, userAgent: ua,
        detail: { reason: 'verify_failed' },
      });
      return NextResponse.json({ error: 'VERIFY_FAILED' }, { status: 400 });
    }

    const info = verification.registrationInfo;
    await insertPasskey({
      staffId,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
      counter: info.credential.counter,
      transports: info.credential.transports,
      aaguid: info.aaguid && info.aaguid !== '00000000-0000-0000-0000-000000000000' ? info.aaguid : null,
      deviceLabel,
    });

    await audit({
      staffId, event: 'passkey.register', result: 'ok', ip, userAgent: ua,
      detail: { deviceLabel, transports: info.credential.transports },
    });

    const res = NextResponse.json({ ok: true });
    // Burn the challenge cookie.
    res.cookies.set(PASSKEY_CHALLENGE_COOKIE, '', {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 0,
    });
    return res;
  } catch (err) {
    console.error('[passkey/register/finish] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
