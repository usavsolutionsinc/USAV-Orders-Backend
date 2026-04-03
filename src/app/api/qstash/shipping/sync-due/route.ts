import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { runShippingSyncDueJob, type ShippingSyncDuePayload } from '@/lib/jobs/shipping-sync-due';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handleSyncDue(request: NextRequest) {
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

export const POST = verifySignatureAppRouter(handleSyncDue);

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'shipping-sync-due' });
}
