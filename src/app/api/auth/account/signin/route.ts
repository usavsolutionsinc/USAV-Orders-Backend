/**
 * POST /api/auth/account/signin  (PUBLIC)
 *
 * Account-level (email + password) login — the cross-org entry point, distinct
 * from the org-scoped station PIN flow (/api/auth/signin). Resolves the account,
 * verifies the password, then:
 *   • 0 memberships  → 403 NO_WORKSPACE
 *   • 1 membership   → sign in directly (mint session for that org's profile)
 *   • >1 memberships → 200 { needsOrgChoice, memberships } unless an
 *                      organizationId is supplied, then sign into that one.
 *
 * Body: { email, password, organizationId? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import {
  createSession,
  cookieMaxAgeForSession,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';
import { getAccountByEmail } from '@/lib/identity/accounts';
import { verifyPassword } from '@/lib/identity/password';
import { listMembershipsForAccount, logAuthEvent } from '@/lib/identity/memberships';

export const runtime = 'nodejs';

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip') || null;
}

const Body = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
  organizationId: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent');

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  const account = await getAccountByEmail(parsed.email);
  // Generic 401 — never reveal whether the email exists.
  const ok = account ? await verifyPassword(parsed.password, account.passwordHash) : false;
  if (!account || !ok) {
    await logAuthEvent({ accountId: account?.id ?? null, orgId: null, event: 'failed_login', ip, userAgent: ua });
    return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
  }
  if (account.status !== 'active') {
    return NextResponse.json({ error: 'ACCOUNT_NOT_ACTIVE' }, { status: 403 });
  }

  const memberships = await listMembershipsForAccount(account.id);
  if (memberships.length === 0) {
    return NextResponse.json({ error: 'NO_WORKSPACE' }, { status: 403 });
  }

  // Resolve which workspace to enter.
  let target = memberships[0]!;
  if (parsed.organizationId) {
    const match = memberships.find((m) => m.organization_id === parsed.organizationId);
    if (!match) return NextResponse.json({ error: 'NOT_A_MEMBER' }, { status: 403 });
    target = match;
  } else if (memberships.length > 1) {
    // Let the client present a workspace picker, then POST again with org id.
    return NextResponse.json({
      needsOrgChoice: true,
      memberships: memberships.map((m) => ({
        organizationId: m.organization_id,
        organizationName: m.organization_name,
      })),
    });
  }

  const session = await createSession({
    staffId: target.staff_id,
    deviceKind: 'personal',
    ip,
    userAgent: ua,
  });

  // Best-effort last-login stamp.
  void pool
    .query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [account.id])
    .catch(() => {});

  await audit({
    staffId: target.staff_id, sid: session.sid,
    event: 'signin.account', result: 'ok', ip, userAgent: ua,
    detail: { accountId: account.id, orgId: target.organization_id },
  });
  await logAuthEvent({ accountId: account.id, orgId: target.organization_id, event: 'login', ip, userAgent: ua });

  const res = NextResponse.json({ ok: true, organizationId: target.organization_id });
  res.cookies.set(SESSION_COOKIE_NAME, session.sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: cookieMaxAgeForSession(session),
  });
  return res;
}
