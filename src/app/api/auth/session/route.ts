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
  cookieMaxAgeForSession,
} from '@/lib/auth/session';
import { getCurrentUserBySid } from '@/lib/auth/current-user';

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

  // Resolve the full user envelope from the DB (roles + overrides). This
  // path matches what withAuth uses for every authenticated request, so the
  // client's `useAuth().has(perm)` and the server's permission gate now
  // see the same set of permissions — no more drift between
  // client-rendered UI and server-enforced API.
  const user = await getCurrentUserBySid(session.sid);
  if (!user || user.role === 'unknown') {
    console.warn(
      `[auth/session] user:null reason=no-staff-row staffId=${session.staffId} sid=${session.sid.slice(0, 8)}…`,
    );
    return NextResponse.json(
      { user: null, debug: 'no-staff-row' },
      { headers: { 'cache-control': 'no-store', 'x-auth-debug': 'no-staff-row' } },
    );
  }

  // Bump last_seen_at so the idle window slides forward on each request, and
  // pick up the (possibly slid) expires_at — for persistent staff touchSession
  // pushes it forward ~1 year on every heartbeat.
  const slidExpiresAt = (await touchSession(session.sid)) ?? session.expiresAt;

  const res = NextResponse.json(
    {
      user: {
        staffId: user.staffId,
        role: user.role,
        permissions: Array.from(user.permissions),
        mobileDisplayConfig: user.mobileDisplayConfig,
        session: {
          sid: session.sid,
          deviceKind: session.deviceKind,
          deviceLabel: session.deviceLabel,
          expiresAt: slidExpiresAt,
        },
      },
    },
    { headers: { 'cache-control': 'no-store', 'x-auth-debug': 'ok' } },
  );

  // Re-issue the cookie so the browser's max-age tracks the live session
  // expiry. Without this the cookie's expiry is frozen at sign-in, so a
  // persistent (sliding) session still gets dropped by the browser when the
  // original max-age elapses — the "have to sign back in every day / after
  // closing the lid" symptom. Setting it every heartbeat keeps the two in sync.
  res.cookies.set(SESSION_COOKIE_NAME, session.sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: cookieMaxAgeForSession({ expiresAt: slidExpiresAt }),
  });

  return res;
}
