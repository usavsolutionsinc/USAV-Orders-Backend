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
  /^\/signup(?:$|\/)/,                  // public account creation
  /^\/account\/signin(?:$|\/)/,         // account-level (email/passkey) sign-in
  /^\/m\/signin(?:$|\/)/,
  /^\/not-authorized(?:$|\/)/,
  /^\/m\/enroll\//,
  /^\/invite\/[A-Za-z0-9_-]+(?:$|\/)/,  // org invitation accept (unauthenticated)
  /^\/api\/auth\//,
  /^\/api\/beta\//,                     // public marketing beta waitlist + spots counter (no auth)
  /^\/api\/health(?:$|\/)/,
  /^\/api\/ready(?:$|\/)/,
  /^\/api\/cron\//,                     // Vercel-cron-fired routes (auth via CRON_SECRET inside handler)
  /^\/api\/webhooks\//,                 // carrier + Stripe + integration callbacks
  /^\/api\/billing\/webhook(?:$|\/)/,   // Stripe webhook needs raw body, no cookie
  // GS1 Digital Link resolver — same printed QR serves both audiences.
  // The handler itself branches on session cookie: authed staff get
  // contextual redirects, anon callers bounce to the public storefront.
  /^\/gs1\/resolve(?:$|\/)/,
  /^\/01\/[0-9]+(?:$|\/)/,
  /^\/414\/[0-9]+\/254\/[A-Za-z0-9]+(?:$|\/)/,
  /^\/_next\//,
  /^\/favicon\.ico$/,
  /^\/manifest\.(json|webmanifest)$/,
  /^\/sw\.js$/,
  /^\/workbox-/,
  /^\/icons?\//,
  /^\/.well-known\//,
];

// Hostnames that should NOT be treated as a tenant subdomain. Anything else
// of the form `slug.<root>` is extracted as a tenant slug and stamped onto
// the request headers so downstream handlers can resolve the org without a
// per-request hit on the DB at the edge.
const RESERVED_SUBDOMAINS = new Set<string>([
  'www',
  'app',
  'api',
  'admin',
  'docs',
  'status',
  'staging',
  'preview',
  // Named Cloudflare dev tunnel (pnpm dev:tunnel:named) — not a tenant slug.
  'usav-dev',
]);

function extractTenantSlug(host: string | null): string | null {
  if (!host) return null;
  // Strip port if present.
  const cleaned = host.split(':')[0]!.toLowerCase();
  // localhost and bare IPs never carry a subdomain.
  if (cleaned === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(cleaned)) return null;
  const parts = cleaned.split('.');
  // Need at least subdomain.root.tld to claim a tenant slug.
  if (parts.length < 3) return null;
  const candidate = parts[0]!;
  if (RESERVED_SUBDOMAINS.has(candidate)) return null;
  // Vercel preview hostnames like usav-orders-git-foo-bar.vercel.app — the
  // subdomain there is the project, not a tenant. Cheap heuristic: any host
  // ending in .vercel.app skips slug extraction.
  if (cleaned.endsWith('.vercel.app')) return null;
  // Dev tunnel hostnames (Cloudflare quick tunnels, ngrok) carry a random
  // subdomain that is not a tenant. Without this, e.g. quiet-frog-1234 from
  // quiet-frog-1234.trycloudflare.com resolves to an unknown org and every
  // org-scoped query (staff picker, etc.) comes back empty on the phone.
  if (
    cleaned.endsWith('.trycloudflare.com') ||
    cleaned.endsWith('.ngrok-free.app') ||
    cleaned.endsWith('.ngrok.app') ||
    cleaned.endsWith('.ngrok.io')
  ) {
    return null;
  }
  return candidate;
}

const REWRITES: ReadonlyArray<{ prefix: string; target: string }> = [
  { prefix: '/m/b/', target: '/bin/' },
  { prefix: '/m/l/', target: '/receiving/lines/' },
  { prefix: '/m/u/', target: '/serial/' },
];

// Dual-route pages that have a dedicated mobile counterpart. When the request
// comes from a phone-class device we rewrite at the edge before any JS runs,
// so old browsers that can't hydrate the React tree still get the right view.
// Exact path match only — sub-pages (e.g. /receiving/lines/[id]) are not
// rewritten because they have no /m/ counterpart.
const MOBILE_UA_REWRITES: ReadonlyMap<string, string> = new Map([
  ['/receiving', '/m/receiving'],
  ['/receiving/', '/m/receiving'],
  // Unbox + Triage surfaces (operator-surfaces refactor) → the mobile receiving
  // shell, whose bottom nav already labels itself "Unbox".
  ['/unbox', '/m/receiving'],
  ['/unbox/', '/m/receiving'],
  ['/triage', '/m/receiving'],
  ['/triage/', '/m/receiving'],
  ['/incoming', '/m/receiving'],
  ['/incoming/', '/m/receiving'],
  // Local Pickup + Receiving History surfaces (operator-surfaces refactor Phase 9)
  // → the mobile receiving shell (same feed, its bottom nav labels itself).
  ['/pickup', '/m/receiving'],
  ['/pickup/', '/m/receiving'],
  ['/receiving/history', '/m/receiving'],
  ['/receiving/history/', '/m/receiving'],
  // Pack surface (operator-surfaces refactor Phase 7) → the redesigned mobile
  // packing shell. Both the canonical `/pack` and the legacy `/packer` land here
  // on phones (the bottom nav already labels it "Packing").
  ['/pack', '/m/pack'],
  ['/pack/', '/m/pack'],
  ['/packer', '/m/pack'],
  ['/packer/', '/m/pack'],
  ['/signin', '/m/signin'],
  ['/signin/', '/m/signin'],
]);

// Phones only — exclude iPad/Android tablets so they keep the desktop view.
// Android phone UA always contains "Mobile"; tablets omit it. iPadOS reports
// a macOS UA (no "iPad" token) so it falls through here as desktop, which is
// the desired behavior. Old iOS and old Android phones do match this pattern.
const MOBILE_UA_RE = /iPhone|iPod|Android.+Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i;

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

function resolveMobileUaRewrite(pathname: string, ua: string | null): string | null {
  if (!ua || !MOBILE_UA_RE.test(ua)) return null;
  // Don't double-rewrite if the client already navigated to /m/*.
  if (pathname.startsWith('/m/')) return null;
  return MOBILE_UA_REWRITES.get(pathname) ?? null;
}

/**
 * Surface-migration redirect (Studio-driven operator surfaces refactor). The
 * Unbox + Triage + Incoming + Pickup + History receiving modes graduated to their
 * own first-class routes (`/unbox`, `/triage`, `/incoming`, `/pickup`,
 * `/receiving/history`), so the address bar names the operator's job. Bare
 * `/receiving` (the Unbox default) and each `/receiving?mode=…` normalize to the
 * new canonical URL, dropping the now-redundant `mode` param (mode-specific
 * search params like History's `?q=`/`?field=`/`?scope=` ride along). Exact path
 * only — sub-routes (`/receiving/lines/[id]`, `/receiving/history`,
 * `/receiving/unfound`, …) keep their URLs.
 */
function resolveReceivingSurfaceRedirect(url: NextRequest['nextUrl']): NextRequest['nextUrl'] | null {
  if (url.pathname !== '/receiving') return null;
  const mode = url.searchParams.get('mode');
  const dest =
    mode === null || mode === 'receive'
      ? '/unbox'
      : mode === 'triage'
        ? '/triage'
        : mode === 'incoming'
          ? '/incoming'
          : mode === 'pickup'
            ? '/pickup'
            : mode === 'history'
              ? '/receiving/history'
              : null;
  if (!dest) return null;
  const next = url.clone();
  next.pathname = dest;
  next.searchParams.delete('mode'); // being on the surface route IS the mode
  return next;
}

/**
 * Pack-surface redirect (operator-surfaces refactor Phase 7). The packing station
 * graduated from `/packer` to the first-class `/pack` route, so the address bar
 * names the operator's job. Bare `/packer` (and `/packer/`) normalize to `/pack`,
 * preserving the `?packMode=` sub-view param. Exact path only — no `/packer`
 * sub-routes exist, but guard against a future one leaking. Desktop only; phones
 * fall through to the `/m/pack` UA rewrite computed above.
 */
function resolvePackSurfaceRedirect(url: NextRequest['nextUrl']): NextRequest['nextUrl'] | null {
  if (url.pathname !== '/packer' && url.pathname !== '/packer/') return null;
  const next = url.clone();
  next.pathname = '/pack';
  return next;
}

/**
 * Test-surface redirect (operator-surfaces refactor Phase 8). The testing station
 * graduated from `/tech` to the first-class `/test` route, so the address bar
 * names the operator's job. `/tech` (and `/tech/`) normalize to `/test`,
 * preserving the `?view=testing` / `?view=testing-history` sub-mode params (they
 * ride along unchanged — the Shipping/Testing/History top-mode is param-based).
 * Exact path only — the `/tech/*` sub-routes (none today) keep their URLs.
 */
function resolveTestSurfaceRedirect(url: NextRequest['nextUrl']): NextRequest['nextUrl'] | null {
  if (url.pathname !== '/tech' && url.pathname !== '/tech/') return null;
  const next = url.clone();
  next.pathname = '/test';
  return next;
}

// Per-section browse filters — mirrors SYSTEM_SAVED_VIEWS in
// `src/lib/operations/saved-view-presets.ts`, INLINED here to keep the Edge
// bundle self-contained (this file's convention; see SESSION_COOKIE_NAME). The
// `view` marker highlights the matching preset chip on landing.
const AUDIT_LOG_SECTION_PARAMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  receiving: { stations: 'RECEIVING', sources: 'sal,inventory', view: 'sys:receiving-audit' },
  packing: { stations: 'PACK', view: 'sys:pack-audit' },
  tech: { stations: 'TECH', view: 'sys:tech-audit' },
};

/**
 * Redirect a legacy `/audit-log/*` URL to its Operations History equivalent
 * (plan §4.1), preferring a system saved-view preset and carrying record params
 * across. **Unconditional as of the Phase 7 cutover** — the `/audit-log` route
 * files are removed, so these URLs (bookmarks / old links) must always land on
 * History rather than 404. (`/settings/audit` is a distinct route, unaffected.)
 */
function resolveAuditLogRedirect(url: NextRequest['nextUrl']): NextRequest['nextUrl'] | null {
  const p = url.pathname;
  if (p !== '/audit-log' && !p.startsWith('/audit-log/')) return null;

  const section =
    p === '/audit-log' || p === '/audit-log/'
      ? ''
      : p.slice('/audit-log/'.length).replace(/\/+$/, '');
  const src = url.searchParams;
  const next = url.clone();
  next.pathname = '/operations';
  const sp = next.searchParams;
  for (const k of [...sp.keys()]) sp.delete(k); // drop audit-log-specific params
  sp.set('mode', 'history');

  const preset = AUDIT_LOG_SECTION_PARAMS[section];
  if (preset) for (const [k, v] of Object.entries(preset)) sp.set(k, v);

  switch (section) {
    case 'trace': {
      const serial = src.get('serial');
      const tracking = src.get('tracking');
      const order = src.get('order');
      if (serial) {
        sp.set('dim', 'serial');
        sp.set('serial', serial);
      } else if (tracking) {
        sp.set('dim', 'tracking');
        sp.set('tracking', tracking);
      } else if (order) {
        sp.set('dim', 'order');
        sp.set('order', order);
      }
      break;
    }
    case 'receiving': {
      const po = src.get('po');
      if (po) sp.set('q', po);
      break;
    }
    case 'packing': {
      const tracking = src.get('tracking');
      if (tracking) {
        sp.set('dim', 'tracking');
        sp.set('tracking', tracking);
      }
      break;
    }
    case 'tech': {
      const session = src.get('session') ?? src.get('staffId');
      if (session && /^\d+$/.test(session)) sp.set('staffId', session);
      break;
    }
    case 'sku': {
      const sku = src.get('sku');
      if (sku) sp.set('q', sku);
      break;
    }
    // '' (bare /audit-log), 'staff', or any other section → plain History landing.
  }
  return next;
}

/**
 * Security response headers. Attached to every response we hand back from
 * the proxy (rewrite, next, redirect, 401). Conservative defaults that
 * preserve the app's existing functionality:
 *
 *  - Camera is allowed on same-origin only (mobile receiving photo capture).
 *  - USB + Serial allowed same-origin only — browser-native silent label
 *    printing (WebUSB / Web Serial) in Settings → Hardware. Without `usb=(self)`
 *    `navigator.usb.requestDevice()` throws "disallowed by permissions policy".
 *  - Mic / geolocation / payment all disabled by default.
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
  'usb=(self)',
  'serial=(self)',
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
  // Path-prefix rewrites take precedence; UA-based rewrites are a fallback
  // for exact paths with a /m/* counterpart (see MOBILE_UA_REWRITES).
  const rewriteTarget =
    resolveRewrite(pathname) ?? resolveMobileUaRewrite(pathname, req.headers.get('user-agent'));

  // Pass the resolved pathname to RSC pages — used by requirePermission to
  // build a `?next=` query when it redirects to /signin.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', rewriteTarget ?? pathname);

  // Stamp the tenant slug (if any) so downstream handlers can resolve the
  // org without re-parsing the host header. The slug is just a hint —
  // the authoritative org id always comes from the session.
  const tenantSlug = extractTenantSlug(req.headers.get('host'));
  if (tenantSlug) {
    requestHeaders.set('x-tenant-slug', tenantSlug);
  }

  const applyRewriteOrNext = (): NextResponse => {
    if (rewriteTarget) {
      const url = req.nextUrl.clone();
      url.pathname = rewriteTarget;
      return applySecurityHeaders(NextResponse.rewrite(url, { request: { headers: requestHeaders } }));
    }
    return applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  };

  // Normalize legacy receiving-surface URLs to their first-class routes
  // (`/receiving` → `/unbox`, `?mode=triage` → `/triage`). Desktop only —
  // phones fall through to the `/m/*` rewrite computed above (rewriteTarget set).
  if (!rewriteTarget) {
    const surfaceRedirect =
      resolveAuditLogRedirect(req.nextUrl) ??
      resolveReceivingSurfaceRedirect(req.nextUrl) ??
      resolvePackSurfaceRedirect(req.nextUrl) ??
      resolveTestSurfaceRedirect(req.nextUrl);
    if (surfaceRedirect) {
      return applySecurityHeaders(NextResponse.redirect(surfaceRedirect));
    }
  }

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
