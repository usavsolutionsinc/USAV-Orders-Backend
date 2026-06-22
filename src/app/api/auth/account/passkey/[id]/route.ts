/**
 * DELETE /api/auth/account/passkey/[id] — remove one of the signed-in account's
 * passkeys. Authenticated + account-scoped (you can only delete your own).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { resolveAccountIdForStaff, logAuthEvent } from '@/lib/identity/memberships';
import { deleteAccountPasskey } from '@/lib/identity/webauthn-account';

export const runtime = 'nodejs';

function idFromUrl(req: Request): string | null {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  return last && last !== 'passkey' ? decodeURIComponent(last) : null;
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const accountId = await resolveAccountIdForStaff(me.staffId);
  if (!accountId) return NextResponse.json({ error: 'MULTI_ORG_NOT_PROVISIONED' }, { status: 409 });

  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const removed = await deleteAccountPasskey(accountId, id);
  if (!removed) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await logAuthEvent({ accountId, orgId: null, event: 'passkey_remove' });
  return NextResponse.json({ ok: true });
}
