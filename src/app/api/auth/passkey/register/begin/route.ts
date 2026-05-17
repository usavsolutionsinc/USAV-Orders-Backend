/**
 * POST /api/auth/passkey/register/begin
 *
 * Two callers:
 *   1. Signed-in user adding a passkey to their account — body: {}
 *   2. Enrollment flow — body: { enrollmentToken: string }
 *
 * Returns the WebAuthn options the browser passes to startRegistration().
 * Sets a short-lived httpOnly cookie holding the challenge; the finish
 * route reads it back. The cookie also carries the target staff_id so the
 * client can't lie about who's registering.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { loadEnrollment } from '@/lib/auth/enrollment';
import { buildRegistrationOptions, PASSKEY_CHALLENGE_COOKIE } from '@/lib/auth/webauthn';
import pool from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const enrollmentToken = (body as { enrollmentToken?: unknown }).enrollmentToken;
    let staffId: number | null = null;
    let staffName = '';

    if (typeof enrollmentToken === 'string' && enrollmentToken) {
      const enr = await loadEnrollment(enrollmentToken);
      if (!enr) {
        return NextResponse.json({ error: 'INVALID_ENROLLMENT' }, { status: 404 });
      }
      staffId = enr.staffId;
    } else {
      const me = await getCurrentUser();
      if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      staffId = me.staffId;
    }

    const r = await pool.query(`SELECT name FROM staff WHERE id = $1 LIMIT 1`, [staffId]);
    const row = r.rows[0] as { name: string | null } | undefined;
    if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    staffName = (row.name || `staff-${staffId}`).trim();

    const options = await buildRegistrationOptions({ req, staffId: staffId!, staffName });

    const payload = Buffer.from(JSON.stringify({ challenge: options.challenge, staffId })).toString('base64url');
    const res = NextResponse.json({ options });
    res.cookies.set(PASSKEY_CHALLENGE_COOKIE, payload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 60,
    });
    return res;
  } catch (err) {
    console.error('[passkey/register/begin] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
