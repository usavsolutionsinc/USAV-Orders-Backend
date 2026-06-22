/**
 * GET /api/auth/account/passkey — list the signed-in account's passkeys.
 *
 * Authenticated; resolves the account from the session's staff profile and
 * returns display metadata only (no secret material).
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { resolveAccountIdForStaff } from '@/lib/identity/memberships';
import { listAccountPasskeyMeta } from '@/lib/identity/webauthn-account';

export const runtime = 'nodejs';

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const accountId = await resolveAccountIdForStaff(me.staffId);
  if (!accountId) return NextResponse.json({ passkeys: [] });
  const passkeys = await listAccountPasskeyMeta(accountId);
  return NextResponse.json({ passkeys });
}
