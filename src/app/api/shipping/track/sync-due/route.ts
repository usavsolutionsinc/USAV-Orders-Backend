import { NextRequest, NextResponse } from 'next/server';
import { runDueShipments } from '@/lib/shipping/scheduler';

export const dynamic = 'force-dynamic';

// Protected by CRON_SECRET — intended for QStash worker wrappers and explicit
// internal calls only. Scheduled execution should go through /api/qstash/*.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured → open (dev only)

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  const bodySecret = req.headers.get('x-cron-secret');
  if (bodySecret === secret) return true;

  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let limit = 50;
  let concurrency = 5;
  let carriers: Array<'UPS' | 'USPS' | 'FEDEX'> | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    if (body.limit) limit = Math.min(Number(body.limit), 200);
    if (body.concurrency) concurrency = Math.min(Number(body.concurrency), 10);
    const carrierInput = body.carrier ?? body.carriers;
    if (carrierInput) {
      const values = Array.isArray(carrierInput) ? carrierInput : [carrierInput];
      const normalized = values
        .map((value) => String(value).toUpperCase())
        .filter((value): value is 'UPS' | 'USPS' | 'FEDEX' => ['UPS', 'USPS', 'FEDEX'].includes(value));
      if (normalized.length > 0) carriers = normalized;
    }
  } catch {
    // body is optional
  }

  try {
    const result = await runDueShipments({ limit, concurrency, carriers });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[shipping/sync-due]', err);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    { ok: false, error: 'Method not allowed. Use POST via the QStash worker route.' },
    { status: 405 }
  );
}
