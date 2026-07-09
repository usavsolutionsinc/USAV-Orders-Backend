import { NextRequest, NextResponse } from 'next/server';
import { publishDbEvent, type RealtimeDbEvent } from '@/lib/realtime/db-events';
import { safeStrEqual } from '@/lib/security/safe-compare';

export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.REALTIME_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';
  if (!secret) return false;

  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ') && safeStrEqual(authHeader.slice(7), secret)) return true;
  const headerSecret = req.headers.get('x-webhook-secret');
  if (headerSecret && safeStrEqual(headerSecret, secret)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: RealtimeDbEvent;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body?.id || !body?.schema || !body?.table || !body?.pk || !body?.op) {
    return NextResponse.json({ error: 'Missing required event fields' }, { status: 400 });
  }

  // Org-namespaced realtime: the emitting DB trigger / sidecar MUST include the
  // owning tenant's organization_id so the row-change event lands on that org's
  // channel only. Fail closed if it's missing or malformed (no cross-tenant
  // broadcast). The emitter's source is the row's own organization_id column.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!body?.orgId || !UUID_RE.test(String(body.orgId))) {
    return NextResponse.json({ error: 'Missing or invalid orgId (tenant) on event' }, { status: 400 });
  }

  await publishDbEvent(body);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    callbackPath: '/api/webhooks/realtime-db',
  });
}
