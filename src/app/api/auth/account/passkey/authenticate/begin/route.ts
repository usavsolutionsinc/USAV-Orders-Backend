/**
 * POST /api/auth/account/passkey/authenticate/begin  (PUBLIC)
 *
 * Returns discoverable (usernameless) WebAuthn options — the authenticator
 * offers its resident credentials and the chosen one resolves to its account.
 * Stashes the challenge in a short-lived cookie for /finish.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  buildAccountAuthenticationOptions,
  ACCOUNT_PASSKEY_CHALLENGE_COOKIE,
} from '@/lib/identity/webauthn-account';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const options = await buildAccountAuthenticationOptions({ req });
    const payload = Buffer.from(JSON.stringify({ challenge: options.challenge })).toString('base64url');
    const res = NextResponse.json({ options });
    res.cookies.set(ACCOUNT_PASSKEY_CHALLENGE_COOKIE, payload, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 5 * 60,
    });
    return res;
  } catch (err) {
    console.error('[account/passkey/authenticate/begin] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
