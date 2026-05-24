import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest, isQStashOrigin } from '@/lib/qstash';
import { runShippingSyncDueJob, type ShippingSyncDuePayload } from '@/lib/jobs/shipping-sync-due';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function execute(payload: ShippingSyncDuePayload) {
  try {
    return NextResponse.json(await runShippingSyncDueJob(payload));
  } catch (error: any) {
    console.error('[shipping/sync-due]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const payload = (await request.json().catch(() => ({}))) as ShippingSyncDuePayload;
  return execute(payload);
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ ok: true, queue: 'vercel-cron', job: 'shipping-sync-due' });
  }
  // Vercel cron passes params via query string; QStash bootstrap (legacy) still POSTs JSON.
  const sp = request.nextUrl.searchParams;
  const carriersParam = sp.getAll('carriers');
  const payload: ShippingSyncDuePayload = {
    limit: sp.get('limit') ?? undefined,
    concurrency: sp.get('concurrency') ?? undefined,
    carriers: carriersParam.length > 0
      ? carriersParam.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
      : undefined,
  };
  return execute(payload);
}
