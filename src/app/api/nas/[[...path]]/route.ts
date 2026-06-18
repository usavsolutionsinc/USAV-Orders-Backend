import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthContext } from '@/lib/auth/withAuth';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getActiveNasBaseUrl } from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  buildNasAgentProxyHeaders,
  nasAgentToken,
  nasAgentUrl,
  resolveNasReceivingUpstream,
  resolveNasReceivingWriteUpstream,
} from '@/lib/nas-agent-client';
import {
  deleteNasLocalFile,
  listNasLocalDir,
  nasPathSegmentsFromProxyPath,
  readNasLocalFile,
  shouldNasProxyUseLocalMount,
  writeNasLocalFile,
} from '@/lib/nas-local-mount';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Same-origin NAS photo proxy — the production write path for the mobile
 * receiving/unboxing capture flow.
 *
 * Why this exists: the app is Vercel-hosted (HTTPS) and the NAS lives on the
 * office LAN. The phone's browser CANNOT WebDAV-PUT straight to the LAN NAS
 * (mixed-content + CORS + per-device Cloudflare-Access cookie), which is why
 * captures silently failed and the Done button white-screened. So the BROWSER
 * now only ever talks to THIS route (same-origin), and the SERVER does the real
 * call out to the NAS through the `nas-photos.michaelgarisek.com` Cloudflare
 * tunnel, carrying the shared `x-agent-token` secret. No CORS, no mixed-content,
 * no per-phone Access cookie.
 *
 *   phone ──same-origin──▶ /api/nas/<path> ──HTTPS + x-agent-token──▶
 *        nas-photos.michaelgarisek.com ──LAN──▶ NAS (read + write)
 *
 * Full CRUD for the receiving folder:
 *   • GET    /api/nas/<dir>/    → JSON directory listing (picker)
 *   • GET    /api/nas/<file>    → image bytes (thumbnails / gallery)
 *   • PUT    /api/nas/<file>    → write one captured photo (image only)
 *   • DELETE /api/nas/<file>    → remove one photo (gallery delete)
 *
 * Upstream resolution: `NAS_RW_URL` env wins; otherwise the org's active NAS
 * base URL (Admin → Receiving Photos). Reads work out of the box against the
 * existing host; writes need the office side to expose the verb on that host
 * (see deploy/nas-photo-server/README.md).
 */

// Only web-renderable image formats may be written — this is a photo store, not
// an arbitrary file drop.
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

async function resolveReadUpstream(ctx: AuthContext): Promise<string> {
  const org = await getOrganization(ctx.organizationId as OrgId);
  const activeNas = org ? getActiveNasBaseUrl(org.settings) : '';
  return resolveNasReceivingUpstream(activeNas);
}

async function resolveWriteUpstream(ctx: AuthContext): Promise<string> {
  const org = await getOrganization(ctx.organizationId as OrgId);
  const activeNas = org ? getActiveNasBaseUrl(org.settings) : '';
  return resolveNasReceivingWriteUpstream(activeNas);
}

function nasWriteFailureHint(status: number): string {
  if (status !== 404) return '';
  if (nasAgentUrl()) {
    return ' — deploy deploy/nas-media-agent on the office Mac (PUT /file/receiving) and route /_agent/* in Caddy';
  }
  return ' — the photo tunnel may be read-only; enable WebDAV PUT or deploy the NAS media agent';
}

function agentToken(): string {
  return nasAgentToken();
}

/**
 * Rebuild the upstream URL from the request, preserving the caller's exact
 * path encoding, trailing slash (directory listings only trigger on one), and
 * query string (e.g. ?thumb=160). `req.nextUrl.pathname` keeps the trailing
 * slash that the catch-all params would otherwise drop.
 */
function buildUpstreamUrl(req: NextRequest, base: string): string | null {
  const sub = req.nextUrl.pathname.replace(/^\/api\/nas\/?/, '');
  // Path-traversal guard: no `..` segments, no scheme/host injection.
  const decoded = decodeURIComponent(sub);
  if (decoded.split('/').some((seg) => seg === '..') || /^([a-z]+:)?\/\//i.test(decoded)) {
    return null;
  }
  // Next.js (trailingSlash: false) 308-redirects the trailing slash off the
  // inbound URL before it reaches this route, but the NAS file server only
  // emits a JSON directory listing when the path ENDS in a slash. Re-add it for
  // non-file paths (no extension) so `GET /api/nas/<folder>` still browses.
  const lastSeg = sub.split('/').pop() || '';
  const isFile = /\.[a-z0-9]+$/i.test(lastSeg);
  const upstreamPath = sub && !isFile ? `${sub}/` : sub;
  return `${base}/${upstreamPath}${req.nextUrl.search}`;
}

// ─── GET: directory listing or file bytes ────────────────────────────────────
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    if (shouldNasProxyUseLocalMount()) {
      const segments = nasPathSegmentsFromProxyPath(req.nextUrl.pathname);
      const lastSeg = segments[segments.length - 1] || '';
      const isFile = /\.[a-z0-9]+$/i.test(lastSeg);
      if (!isFile) {
        const listed = await listNasLocalDir(segments);
        if (!listed.ok) {
          return NextResponse.json({ error: listed.error }, { status: listed.status });
        }
        return NextResponse.json(listed.entries, { headers: { 'Cache-Control': 'no-store' } });
      }
      const file = await readNasLocalFile(segments);
      if (!file.ok) {
        return NextResponse.json({ error: file.error }, { status: file.status });
      }
      return new NextResponse(new Uint8Array(file.body), {
        headers: {
          'Content-Type': file.contentType,
          'Cache-Control': 'private, max-age=600',
        },
      });
    }

    const base = await resolveReadUpstream(ctx);
    if (!base) return NextResponse.json({ error: 'NAS not configured' }, { status: 503 });
    const url = buildUpstreamUrl(req, base);
    if (!url) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    let upstream: Response;
    try {
      const agentHeaders = await buildNasAgentProxyHeaders(
        ctx.organizationId as OrgId,
        'receiving',
        base,
      );
      upstream = await fetch(url, {
        method: 'GET',
        headers: {
          // The NAS file server returns a JSON listing for directories when the
          // caller asks for JSON; pass the client's Accept through verbatim.
          Accept: req.headers.get('accept') || 'application/json',
          ...(agentToken() ? { 'x-agent-token': agentToken() } : {}),
          ...agentHeaders,
        },
        cache: 'no-store',
      });
    } catch {
      return NextResponse.json({ error: 'NAS unreachable' }, { status: 502 });
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `NAS read failed (HTTP ${upstream.status})` },
        { status: upstream.status === 404 ? 404 : 502 },
      );
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const isListing = contentType.includes('application/json');
    const body = await upstream.arrayBuffer();
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': contentType,
        // Listings stay fresh; image bytes are immutable for a stable filename,
        // so let the browser cache them and spare repeat trips through Vercel.
        'Cache-Control': isListing ? 'no-store' : 'private, max-age=600',
      },
    });
  },
  { permission: 'receiving.view' },
);

// ─── PUT: write one captured photo ───────────────────────────────────────────
export const PUT = withAuth(
  async (req: NextRequest, ctx) => {
    if (shouldNasProxyUseLocalMount()) {
      if (!IMAGE_RE.test(req.nextUrl.pathname)) {
        return NextResponse.json({ error: 'only image files are allowed' }, { status: 400 });
      }
      const segments = nasPathSegmentsFromProxyPath(req.nextUrl.pathname);
      const body = await req.arrayBuffer();
      const written = await writeNasLocalFile(segments, body);
      if (!written.ok) {
        return NextResponse.json({ error: written.error }, { status: written.status });
      }
      return new NextResponse(null, { status: 201 });
    }

    const base = await resolveWriteUpstream(ctx);
    if (!base) return NextResponse.json({ error: 'NAS not configured' }, { status: 503 });
    const url = buildUpstreamUrl(req, base);
    if (!url) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (!IMAGE_RE.test(req.nextUrl.pathname)) {
      return NextResponse.json({ error: 'only image files are allowed' }, { status: 400 });
    }

    const body = await req.arrayBuffer();
    if (body.byteLength === 0) {
      return NextResponse.json({ error: 'empty body' }, { status: 400 });
    }

    let upstream: Response;
    try {
      const agentHeaders = await buildNasAgentProxyHeaders(
        ctx.organizationId as OrgId,
        'receiving',
        base,
      );
      upstream = await fetch(url, {
        method: 'PUT',
        body: new Uint8Array(body),
        headers: {
          'Content-Type': req.headers.get('content-type') || 'image/jpeg',
          ...(agentToken() ? { 'x-agent-token': agentToken() } : {}),
          ...agentHeaders,
        },
        cache: 'no-store',
      });
    } catch {
      return NextResponse.json({ error: 'NAS unreachable' }, { status: 502 });
    }

    // WebDAV PUT: 200/201 (created) and 204 (overwritten) are all success.
    if (upstream.ok || upstream.status === 201 || upstream.status === 204) {
      return new NextResponse(null, { status: 201 });
    }
    return NextResponse.json(
      {
        error: `NAS write failed (HTTP ${upstream.status})${nasWriteFailureHint(upstream.status)}`,
      },
      { status: 502 },
    );
  },
  { permission: 'receiving.upload_photo' },
);

// ─── DELETE: remove one photo ────────────────────────────────────────────────
export const DELETE = withAuth(
  async (req: NextRequest, ctx) => {
    if (shouldNasProxyUseLocalMount()) {
      const segments = nasPathSegmentsFromProxyPath(req.nextUrl.pathname);
      const removed = await deleteNasLocalFile(segments);
      if (!removed.ok) {
        return NextResponse.json({ error: removed.error }, { status: removed.status });
      }
      return new NextResponse(null, { status: 204 });
    }

    const base = await resolveWriteUpstream(ctx);
    if (!base) return NextResponse.json({ error: 'NAS not configured' }, { status: 503 });
    const url = buildUpstreamUrl(req, base);
    if (!url) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    let upstream: Response;
    try {
      const agentHeaders = await buildNasAgentProxyHeaders(
        ctx.organizationId as OrgId,
        'receiving',
        base,
      );
      upstream = await fetch(url, {
        method: 'DELETE',
        headers: {
          ...(agentToken() ? { 'x-agent-token': agentToken() } : {}),
          ...agentHeaders,
        },
        cache: 'no-store',
      });
    } catch {
      return NextResponse.json({ error: 'NAS unreachable' }, { status: 502 });
    }

    // 200/202/204 = deleted; 404 = already gone — both mean the file is gone.
    if (upstream.ok || upstream.status === 204 || upstream.status === 404) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(
      { error: `NAS delete failed (HTTP ${upstream.status})` },
      { status: 502 },
    );
  },
  { permission: 'receiving.upload_photo' },
);
