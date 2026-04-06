import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { runShippingSyncDueJob, type ShippingSyncDuePayload } from '@/lib/jobs/shipping-sync-due';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as ShippingSyncDuePayload;
  try {
    return NextResponse.json(await runShippingSyncDueJob(payload));
  } catch (error: any) {
    console.error('[qstash/shipping/sync-due]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'shipping-sync-due' });
}
