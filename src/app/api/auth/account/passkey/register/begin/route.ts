/**
 * POST /api/auth/account/passkey/register/begin
 *
 * Signed-in user adds a passkey to their GLOBAL account (for cross-org,
 * passwordless sign-in). Returns WebAuthn registration options; stashes the
 * challenge + account id in a short-lived cookie that /finish reads back.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/current-user';
import { resolveAccountIdForStaff } from '@/lib/identity/memberships';
import {
  buildAccountRegistrationOptions,
  ACCOUNT_PASSKEY_CHALLENGE_COOKIE,
} from '@/lib/identity/webauthn-account';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

    const accountId = await resolveAccountIdForStaff(me.staffId);
    if (!accountId) return NextResponse.json({ error: 'MULTI_ORG_NOT_PROVISIONED' }, { status: 409 });

    const r = await pool.query<{ primary_email: string | null; display_name: string | null }>(
      `SELECT primary_email, display_name FROM accounts WHERE id = $1 LIMIT 1`,
      [accountId],
    );
    const acc = r.rows[0];
    const userName = (acc?.primary_email || acc?.display_name || me.name || `account-${accountId.slice(0, 8)}`).trim();
    const displayName = (acc?.display_name || me.name || userName).trim();

    const options = await buildAccountRegistrationOptions({ req, accountId, userName, displayName });

    const payload = Buffer.from(JSON.stringify({ challenge: options.challenge, accountId })).toString('base64url');
    const res = NextResponse.json({ options });
    res.cookies.set(ACCOUNT_PASSKEY_CHALLENGE_COOKIE, payload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 60,
    });
    return res;
  } catch (err) {
    console.error('[account/passkey/register/begin] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
