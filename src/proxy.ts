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
  /^\/m\/signin(?:$|\/)/,
  /^\/not-authorized(?:$|\/)/,
  /^\/m\/enroll\//,
  /^\/api\/auth\//,
  /^\/api\/health(?:$|\/)/,
  /^\/api\/qstash\//,
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
 * Auth enforcement is unconditional. The proxy never serves a page or API
 * route to an unauthenticated client outside the PUBLIC_PATHS allowlist
 * (/signin, /not-authorized, /m/enroll/*, /api/auth/*, static assets).
 *
 * 🚨 BREAK-GLASS ESCAPE HATCH (operator-only, not for normal rollout):
 *   AUTH_V2_ENABLED=false (or "0", "shadow", "off")
 *     → proxy stops redirecting/401-ing unauthenticated requests
 *     → `withAuth` and `requirePermission` STILL enforce per-route/per-page
 *     → so disabling this only removes the edge redirect, not the actual auth
 *
 * The downstream wrappers no longer honour this flag (Phase 1, 2026-05-17) —
 * they always enforce. The flag survives at proxy level only as a knob for
 * the rare case where the edge-runtime cookie check itself misfires and ops
 * needs to fall back to wrapper-level enforcement.
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

/**
 * Security response headers. Attached to every response we hand back from
 * the proxy (rewrite, next, redirect, 401). Conservative defaults that
 * preserve the app's existing functionality:
 *
 *  - Camera is allowed on same-origin only (mobile receiving photo capture).
 *  - Mic / geolocation / payment / usb / fullscreen all disabled by default.
 *  - frame-ancestors 'self' (CSP) + X-Frame-Options DENY — defense in depth.
 *  - HSTS with 1y max-age + subdomains. Don't preload yet (irreversible).
 *  - Referrer policy trims cross-origin leak surface.
 *  - nosniff blocks MIME confusion attacks.
 */
const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'fullscreen=(self)',
  'interest-cohort=()',
].join(', ');

function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
  // Block embedding in iframes from foreign origins. X-Frame-Options is the
  // legacy header; CSP frame-ancestors covers modern browsers.
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  // We intentionally only set frame-ancestors here, not a full CSP — a full
  // CSP needs hashes/nonces for inline scripts the framework emits, which
  // is a separate effort. frame-ancestors is safe to set alone.
  const existingCsp = res.headers.get('Content-Security-Policy');
  res.headers.set(
    'Content-Security-Policy',
    existingCsp ? `${existingCsp}; frame-ancestors 'self'` : `frame-ancestors 'self'`,
  );
  return res;
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
      return applySecurityHeaders(NextResponse.rewrite(url, { request: { headers: requestHeaders } }));
    }
    return applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  };

  if (isPublic(pathname)) {
    return applyRewriteOrNext();
  }

  // Break-glass off: never block. Default: redirect HTML routes / 401 JSON.
  if (!hasCookie && isAuthV2Enabled()) {
    const isApi = pathname.startsWith('/api/');
    if (isApi) {
      return applySecurityHeaders(NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 }));
    }
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    url.searchParams.set('next', pathname);
    return applySecurityHeaders(NextResponse.redirect(url));
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
