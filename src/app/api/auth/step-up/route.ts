/**
 * POST /api/auth/step-up
 *
 * Body: { scope: string, method: 'pin' | 'passkey', pin?: string,
 *         response?: AuthenticationResponseJSON }
 *
 * Grants a step-up trust window for the current session and named scope.
 * Required before destructive actions (bin.remove, shipping.void_order,
 * admin.manage_staff, etc).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { verifyStaffPin, PinError } from '@/lib/auth/pin';
import {
  bumpPasskeyCounter,
  PASSKEY_CHALLENGE_COOKIE,
  verifyAuthentication,
} from '@/lib/auth/webauthn';
import { grantStepUp } from '@/lib/auth/stepup';
import { audit } from '@/lib/auth/audit';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

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
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const scope = String((body as { scope?: unknown }).scope ?? '').trim();
    const method = String((body as { method?: unknown }).method ?? '').trim();
    if (!scope) return NextResponse.json({ error: 'INVALID_REQUEST', field: 'scope' }, { status: 400 });

    if (method === 'pin') {
      const pin = String((body as { pin?: unknown }).pin ?? '');
      try {
        await verifyStaffPin(me.staffId, pin);
      } catch (err) {
        await audit({
          staffId: me.staffId, sid: me.session.sid,
          event: 'stepup', result: 'denied', ip, userAgent: ua,
          detail: { scope, method, reason: err instanceof PinError ? err.code : 'error' },
        });
        if (err instanceof PinError) {
          return NextResponse.json({ error: err.code }, { status: 401 });
        }
        throw err;
      }
      await grantStepUp(me.session.sid, scope, 'pin');
      await audit({
        staffId: me.staffId, sid: me.session.sid,
        event: 'stepup', result: 'ok', ip, userAgent: ua,
        detail: { scope, method: 'pin' },
      });
      return NextResponse.json({ ok: true });
    }

    if (method === 'passkey') {
      const response = (body as { response?: unknown }).response as AuthenticationResponseJSON | undefined;
      if (!response) {
        return NextResponse.json({ error: 'INVALID_REQUEST', field: 'response' }, { status: 400 });
      }
      const cookie = req.cookies.get(PASSKEY_CHALLENGE_COOKIE)?.value;
      if (!cookie) return NextResponse.json({ error: 'CHALLENGE_MISSING' }, { status: 400 });
      let challenge: string;
      try {
        const decoded = JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as { challenge: string };
        challenge = decoded.challenge;
      } catch {
        return NextResponse.json({ error: 'CHALLENGE_INVALID' }, { status: 400 });
      }
      const result = await verifyAuthentication({ req, expectedChallenge: challenge, response });
      if (!result.verified || !result.passkey || !result.info) {
        await audit({
          staffId: me.staffId, sid: me.session.sid,
          event: 'stepup', result: 'denied', ip, userAgent: ua,
          detail: { scope, method: 'passkey', reason: 'verify_failed' },
        });
        return NextResponse.json({ error: 'VERIFY_FAILED' }, { status: 401 });
      }
      // Belt-and-braces: only grant if the passkey is for the signed-in user.
      if (result.passkey.staff_id !== me.staffId) {
        return NextResponse.json({ error: 'PASSKEY_MISMATCH' }, { status: 403 });
      }
      await bumpPasskeyCounter(result.passkey.id, result.info.newCounter);
      await grantStepUp(me.session.sid, scope, 'passkey');
      await audit({
        staffId: me.staffId, sid: me.session.sid,
        event: 'stepup', result: 'ok', ip, userAgent: ua,
        detail: { scope, method: 'passkey' },
      });
      const res = NextResponse.json({ ok: true });
      res.cookies.set(PASSKEY_CHALLENGE_COOKIE, '', {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', path: '/', maxAge: 0,
      });
      return res;
    }

    return NextResponse.json({ error: 'UNSUPPORTED_METHOD', method }, { status: 400 });
  } catch (err) {
    console.error('[/api/auth/step-up] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
