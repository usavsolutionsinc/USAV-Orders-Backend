/**
 * Global proxy (formerly `middleware.ts`). Handles two concerns:
 *
 * 1. Auth gate (shadow + enforce modes) — checks for the session cookie,
 *    attaches `x-pathname` to the request headers, and either passes
 *    through (shadow), redirects HTML to /signin, or returns 401 JSON
 *    for API routes when AUTH_V2_ENABLED is set.
 *
 * 2. Legacy QR-code rewrites — printed labels point to /m/b, /m/l, /m/u;
 *    rewrite those to their canonical app paths in-place (no extra
 *    round-trip). Device-specific routes (/m/enroll, /m/r/*, /m/scan)
 *    stay at /m/* untouched.
 *
 * Edge runtime caveat: this file is bundled for the Edge runtime, where
 * `node:crypto`, `pg`, and the existing pool can't run. It does NOT touch
 * the database — it only checks for cookie presence. The actual session
 * lookup happens inside Node-runtime route handlers via `withAuth` /
 * `requirePermission`.
 */

import { NextRequest, NextResponse } from 'next/server';

// Inlined (not imported) to keep the Edge bundle free of node:crypto / pg.
// Must stay in sync with `src/lib/auth/session.ts`.
const SESSION_COOKIE_NAME = 'usav_sid';

const PUBLIC_PATHS: ReadonlyArray<RegExp> = [
  /^\/signin(?:$|\/)/,
  /^\/not-authorized(?:$|\/)/,
  /^\/m\/enroll\//,
  /^\/api\/auth\//,
  /^\/api\/health(?:$|\/)/,
  /^\/_next\//,
  /^\/favicon\.ico$/,
  /^\/manifest\.(json|webmanifest)$/,
  /^\/sw\.js$/,
  /^\/workbox-/,
  /^\/icons?\//,
  /^\/.well-known\//,
];

const REWRITES: ReadonlyArray<{ prefix: string; target: string }> = [
  { prefix: '/m/b/', target: '/bin/' },
  { prefix: '/m/l/', target: '/receiving/lines/' },
  { prefix: '/m/u/', target: '/serial/' },
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

/**
 * Auth enforcement is ON by default. The site must never serve a page or API
 * route to an unauthenticated client outside the PUBLIC_PATHS allowlist
 * (/signin, /not-authorized, /m/enroll/*, /api/auth/*, static assets).
 *
 * Emergency escape hatch: set AUTH_V2_ENABLED=false (or "shadow"/"0") to
 * disable enforcement temporarily. Anything else — including unset — enforces.
 */
function isAuthV2Enabled(): boolean {
  const v = (process.env.AUTH_V2_ENABLED ?? '').toLowerCase().trim();
  return v !== 'false' && v !== '0' && v !== 'shadow' && v !== 'off';
}

function resolveRewrite(pathname: string): string | null {
  for (const { prefix, target } of REWRITES) {
    if (pathname.startsWith(prefix)) {
      return target + pathname.slice(prefix.length);
    }
  }
  return null;
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  const rewriteTarget = resolveRewrite(pathname);

  // Pass the resolved pathname to RSC pages — used by requirePermission to
  // build a `?next=` query when it redirects to /signin.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', rewriteTarget ?? pathname);

  const applyRewriteOrNext = (): NextResponse => {
    if (rewriteTarget) {
      const url = req.nextUrl.clone();
      url.pathname = rewriteTarget;
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  if (isPublic(pathname)) {
    return applyRewriteOrNext();
  }

  // Shadow mode: never block. Enforce mode: redirect HTML routes / 401 JSON.
  if (!hasCookie && isAuthV2Enabled()) {
    const isApi = pathname.startsWith('/api/');
    if (isApi) {
      return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return applyRewriteOrNext();
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static files; the regex
    // PUBLIC_PATHS above does the fine-grained allowlist.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
