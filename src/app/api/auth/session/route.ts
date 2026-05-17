/**
 * GET /api/auth/session
 *
 * Returns the current user envelope used by AuthContext on the client.
 * Always 200 — `user: null` if no session. Never throws.
 *
 * When the resolved user is null, attaches an `x-auth-debug` response header
 * (and logs a single line server-side) with the *reason* — one of:
 *   no-cookie · sid-malformed · no-row · revoked · expired ·
 *   idle-timed-out · db-error · no-staff-row
 * Use this to tell apart "the user never signed in" from "their session was
 * idle-killed" when a reload unexpectedly bounces them to /signin.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  loadSessionWithReason,
  SESSION_COOKIE_NAME,
  touchSession,
} from '@/lib/auth/session';
import { getStaffRole, permissionsSetForRole } from '@/lib/auth/permissions';

export const runtime = 'nodejs';

export async function GET() {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE_NAME)?.value ?? null;
  const { session, reason } = await loadSessionWithReason(sid);

  if (!session) {
    console.warn(
      `[auth/session] user:null reason=${reason} sid=${sid ? `${sid.slice(0, 8)}…` : 'none'}`,
    );
    const res = NextResponse.json(
      { user: null, debug: reason },
      { headers: { 'cache-control': 'no-store', 'x-auth-debug': reason } },
    );
    // Critical: if the cookie was present but the session it points to is
    // invalid (revoked / expired / idle-killed / no-row), clear the cookie
    // so the next reload triggers the proxy's no-cookie redirect to /signin.
    // Without this the zombie cookie keeps the page rendering forever and
    // the user has to manually clear cookies to get unstuck.
    if (sid && reason !== 'no-cookie') {
      res.cookies.set(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
    }
    return res;
  }

  // Have a session but we still need the staff role for the envelope.
  const role = await getStaffRole(session.staffId);
  if (role === 'unknown') {
    console.warn(
      `[auth/session] user:null reason=no-staff-row staffId=${session.staffId} sid=${session.sid.slice(0, 8)}…`,
    );
    return NextResponse.json(
      { user: null, debug: 'no-staff-row' },
      { headers: { 'cache-control': 'no-store', 'x-auth-debug': 'no-staff-row' } },
    );
  }

  // Bump last_seen_at so the idle window slides forward on each request.
  // Best-effort; intentionally not awaited's failure modes mirror loadSession.
  void touchSession(session.sid);

  return NextResponse.json(
    {
      user: {
        staffId: session.staffId,
        role,
        permissions: Array.from(permissionsSetForRole(role)),
        session: {
          sid: session.sid,
          deviceKind: session.deviceKind,
          deviceLabel: session.deviceLabel,
          expiresAt: session.expiresAt,
        },
      },
    },
    { headers: { 'cache-control': 'no-store', 'x-auth-debug': 'ok' } },
  );
}
