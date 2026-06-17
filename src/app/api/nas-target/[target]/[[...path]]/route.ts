import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import type { PermissionString } from '@/lib/auth/permissions-shared';
import { buildNasAgentProxyHeaders, nasAgentToken, nasAgentUrl } from '@/lib/nas-agent-client';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type NasTarget = 'receiving' | 'shipping' | 'claims';

const IMAGE_OR_DOC_RE = /\.(jpe?g|png|webp|gif|pdf|txt)$/i;

function agentBase(): string {
  return nasAgentUrl();
}

function agentToken(): string {
  return nasAgentToken();
}

function parseTarget(req: NextRequest): NasTarget | null {
  const m = /^\/api\/nas-target\/([^/]+)/.exec(req.nextUrl.pathname);
  const value = decodeURIComponent(m?.[1] || '');
  return value === 'receiving' || value === 'shipping' || value === 'claims' ? value : null;
}

function buildAgentFileUrl(req: NextRequest, target: NasTarget, base: string): string | null {
  const prefix = `/api/nas-target/${target}`;
  const sub = req.nextUrl.pathname.slice(prefix.length).replace(/^\/+/, '');
  const decoded = decodeURIComponent(sub);
  if (decoded.split('/').some((seg) => seg === '..') || /^([a-z]+:)?\/\//i.test(decoded)) {
    return null;
  }
  const lastSeg = sub.split('/').pop() || '';
  const isFile = /\.[a-z0-9]+$/i.test(lastSeg);
  const upstreamPath = sub && !isFile ? `${sub}/` : sub;
  return `${base}/file/${target}/${upstreamPath}${req.nextUrl.search}`;
}

function requiredPermission(target: NasTarget, method: string): PermissionString {
  if (method === 'GET' || method === 'HEAD') {
    return target === 'shipping' ? 'orders.view' : 'receiving.view';
  }
  if (target === 'shipping') return 'orders.create';
  return 'receiving.upload_photo';
}

async function proxy(req: NextRequest) {
  const target = parseTarget(req);
  if (!target) return NextResponse.json({ error: 'Unknown NAS target' }, { status: 404 });
  const gate = await requireRoutePerm(req, requiredPermission(target, req.method));
  if (gate.denied) return gate.denied;

  const base = agentBase();
  if (!base) return NextResponse.json({ error: 'NAS agent not configured' }, { status: 503 });

  const url = buildAgentFileUrl(req, target, base);
  if (!url) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if ((req.method === 'PUT' || req.method === 'DELETE') && !IMAGE_OR_DOC_RE.test(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'file type not allowed' }, { status: 400 });
  }

  let body: ArrayBuffer | undefined;
  if (req.method === 'PUT') {
    const ab = await req.arrayBuffer();
    if (ab.byteLength === 0) return NextResponse.json({ error: 'empty body' }, { status: 400 });
    body = ab;
  }

  let upstream: Response;
  try {
    const agentHeaders = await buildNasAgentProxyHeaders(
      gate.ctx.organizationId as OrgId,
      target,
      base,
    );
    upstream = await fetch(url, {
      method: req.method,
      body,
      headers: {
        Accept: req.headers.get('accept') || 'application/json',
        'Content-Type': req.headers.get('content-type') || 'application/octet-stream',
        ...(agentToken() ? { 'x-agent-token': agentToken() } : {}),
        ...agentHeaders,
      },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'NAS agent unreachable' }, { status: 502 });
  }

  if (req.method === 'DELETE' && (upstream.ok || upstream.status === 404)) {
    return new NextResponse(null, { status: 204 });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const payload = await upstream.arrayBuffer();
  return new NextResponse(new Uint8Array(payload), {
    status: upstream.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': contentType.startsWith('image/')
        ? 'private, max-age=600'
        : 'no-store',
    },
  });
}

export const GET = proxy;
export const HEAD = proxy;
export const PUT = proxy;
export const DELETE = proxy;
