import { NextRequest, NextResponse } from 'next/server';
import { publishDbEvent, type RealtimeDbEvent } from '@/lib/realtime/db-events';

export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.REALTIME_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';
  if (!secret) return false;

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;
  if (req.headers.get('x-webhook-secret') === secret) return true;
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

  await publishDbEvent(body);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    callbackPath: '/api/webhooks/realtime-db',
  });
}
