/**
 * POST /api/auth/passkey/authenticate/finish
 *
 * Body: { response: AuthenticationResponseJSON, deviceKind?, deviceLabel? }
 *
 * Verifies the assertion, bumps the credential counter, creates a session,
 * sets the cookie. Same downstream behaviour as PIN signin.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  bumpPasskeyCounter,
  PASSKEY_CHALLENGE_COOKIE,
  verifyAuthentication,
} from '@/lib/auth/webauthn';
import {
  createSession,
  getCookieMaxAgeSeconds,
  SESSION_COOKIE_NAME,
  type DeviceKind,
} from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';
import { getStaffRole } from '@/lib/auth/permissions';
import pool from '@/lib/db';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

export const runtime = 'nodejs';

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip') || null;
}

function asDeviceKind(raw: unknown): DeviceKind {
  if (raw === 'station' || raw === 'personal' || raw === 'phone') return raw;
  return 'personal';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent');

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const response = (body as { response?: unknown }).response as AuthenticationResponseJSON | undefined;
    const deviceKind = asDeviceKind((body as { deviceKind?: unknown }).deviceKind);
    const deviceLabel = ((body as { deviceLabel?: unknown }).deviceLabel ?? null) as string | null;
    if (!response) {
      return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    const cookie = req.cookies.get(PASSKEY_CHALLENGE_COOKIE)?.value;
    if (!cookie) {
      return NextResponse.json({ error: 'CHALLENGE_MISSING' }, { status: 400 });
    }
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
        staffId: result.passkey?.staff_id ?? null,
        event: 'signin.passkey', result: 'denied', ip, userAgent: ua,
        detail: { reason: 'verify_failed' },
      });
      return NextResponse.json({ error: 'VERIFY_FAILED' }, { status: 401 });
    }

    await bumpPasskeyCounter(result.passkey.id, result.info.newCounter);

    // Make sure the row is still active before issuing a session.
    const s = await pool.query(
      `SELECT id, name, role, status FROM staff WHERE id = $1 LIMIT 1`,
      [result.passkey.staff_id],
    );
    const staffRow = s.rows[0] as { id: number; name: string; role: string; status: string } | undefined;
    if (!staffRow || (staffRow.status && staffRow.status !== 'active')) {
      await audit({
        staffId: result.passkey.staff_id, event: 'signin.passkey', result: 'denied',
        ip, userAgent: ua, detail: { reason: 'status', status: staffRow?.status },
      });
      return NextResponse.json({ error: 'ACCOUNT_NOT_ACTIVE' }, { status: 403 });
    }

    const session = await createSession({
      staffId: staffRow.id,
      deviceKind,
      deviceLabel,
      ip,
      userAgent: ua,
    });

    await audit({
      staffId: staffRow.id, sid: session.sid,
      event: 'signin.passkey', result: 'ok',
      ip, userAgent: ua,
      detail: { deviceKind, passkeyId: result.passkey.id },
    });

    const role = await getStaffRole(staffRow.id);
    const res = NextResponse.json({
      ok: true,
      staffId: staffRow.id,
      role,
      name: staffRow.name,
      session: { sid: session.sid, deviceKind, expiresAt: session.expiresAt },
    });
    res.cookies.set(SESSION_COOKIE_NAME, session.sid, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: getCookieMaxAgeSeconds(deviceKind),
    });
    res.cookies.set(PASSKEY_CHALLENGE_COOKIE, '', {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 0,
    });
    return res;
  } catch (err) {
    console.error('[passkey/authenticate/finish] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
