/**
 * POST /api/auth/switch-org
 *
 * Body: { organizationId: string }
 *
 * Switches the active workspace for the CURRENTLY signed-in account. Unlike
 * /api/auth/switch (which re-authenticates as a different staff via PIN), this
 * is the same human changing org context — so no credential is required. The
 * authorization gate is membership ownership: the account must have an active
 * membership in the target org (findSwitchTarget), otherwise 403.
 *
 * Mechanism (see docs/identity-layer-plan.md): switching means pointing the
 * session at the account's STAFF PROFILE row in the target org. A fresh session
 * is minted for that staff id (which carries the new organization_id), the old
 * session is revoked, and the cookie is overwritten. The client then hard-
 * reloads so all React Query caches, Ably subscriptions, and the RLS GUC reset
 * cleanly to the new tenant.
 *
 * Audit: `signin.switch_org` (legacy audit log) + auth_events('switch_org').
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createSession,
  cookieMaxAgeForSession,
  loadSession,
  revokeSession,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';
import {
  resolveAccountIdForStaff,
  findSwitchTarget,
  logAuthEvent,
} from '@/lib/identity/memberships';

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
    const organizationId = String((body as { organizationId?: unknown }).organizationId ?? '');
    if (!organizationId) {
      return NextResponse.json({ error: 'INVALID_REQUEST', field: 'organizationId' }, { status: 400 });
    }

    // Must be signed in to switch.
    const prevSid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    const prev = prevSid ? await loadSession(prevSid) : null;
    if (!prev) {
      return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 });
    }

    // Already in the target org → no-op success (lets the client reload safely).
    if (prev.organizationId === organizationId) {
      return NextResponse.json({ ok: true, organizationId, unchanged: true });
    }

    // Resolve the global account behind the current staff profile.
    const accountId = await resolveAccountIdForStaff(prev.staffId);
    if (!accountId) {
      // staff not yet linked to an account (pre-migration / unprovisioned).
      return NextResponse.json({ error: 'MULTI_ORG_NOT_PROVISIONED' }, { status: 409 });
    }

    // Authorization gate: the account must be an active member of the target.
    const target = await findSwitchTarget(accountId, organizationId);
    if (!target) {
      await audit({
        staffId: prev.staffId, event: 'signin.switch_org', result: 'denied', ip, userAgent: ua,
        detail: { reason: 'not_a_member', targetOrgId: organizationId, accountId },
      });
      return NextResponse.json({ error: 'NOT_A_MEMBER' }, { status: 403 });
    }

    // Mint a session for the target-org profile (inherits its organization_id),
    // reusing the current device kind/label so session policy is unchanged.
    const session = await createSession({
      staffId: target.staffId,
      deviceKind: prev.deviceKind,
      deviceLabel: prev.deviceLabel,
      ip,
      userAgent: ua,
    });

    // Revoke the old session AFTER minting the new one (crash-safe ordering).
    await revokeSession(prev.sid);

    await audit({
      staffId: target.staffId, sid: session.sid,
      event: 'signin.switch_org', result: 'ok', ip, userAgent: ua,
      detail: {
        accountId,
        fromOrgId: prev.organizationId,
        toOrgId: organizationId,
        previousStaffId: prev.staffId,
        previousSid: prev.sid,
      },
    });
    await logAuthEvent({ accountId, orgId: organizationId, event: 'switch_org', ip, userAgent: ua });

    const res = NextResponse.json({
      ok: true,
      organizationId,
      staffId: target.staffId,
      session: { sid: session.sid, deviceKind: session.deviceKind, expiresAt: session.expiresAt },
    });
    res.cookies.set(SESSION_COOKIE_NAME, session.sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: cookieMaxAgeForSession(session),
    });
    return res;
  } catch (err) {
    console.error('[/api/auth/switch-org] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
