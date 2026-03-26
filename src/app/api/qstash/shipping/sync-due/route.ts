import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';
import { runShippingSyncDueJob, type ShippingSyncDuePayload } from '@/lib/jobs/shipping-sync-due';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handleSyncDue(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as ShippingSyncDuePayload;
  return NextResponse.json(await runShippingSyncDueJob(payload));
}

export const POST = verifySignatureAppRouter(handleSyncDue, {
  url: `${getAppBaseUrl()}/api/qstash/shipping/sync-due`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'shipping-sync-due' });
}
