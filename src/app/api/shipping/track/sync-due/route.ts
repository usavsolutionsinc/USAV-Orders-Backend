import { NextRequest, NextResponse } from 'next/server';
import { runShippingSyncDueJob, type ShippingSyncDuePayload } from '@/lib/jobs/shipping-sync-due';
import { logRouteMetric } from '@/lib/route-metrics';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let ok = false;
  try {
    const body = (await req.json().catch(() => ({}))) as ShippingSyncDuePayload;
    const result = await runShippingSyncDueJob(body);
    ok = true;
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[shipping/sync-due]', err);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  } finally {
    logRouteMetric({
      route: '/api/shipping/track/sync-due',
      method: 'POST',
      startedAt,
      ok,
    });
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: 'Method not allowed. Use POST via the QStash worker route.' },
    { status: 405 }
  );
}
