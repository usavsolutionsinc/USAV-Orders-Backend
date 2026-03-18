import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handleSyncDue(request: NextRequest) {
  const baseUrl = getAppBaseUrl();
  const cronSecret = process.env.CRON_SECRET;
  const url = `${baseUrl}/api/shipping/track/sync-due`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cronSecret && { Authorization: `Bearer ${cronSecret}` }),
    },
    body: JSON.stringify({}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  return NextResponse.json(data);
}

export const POST = verifySignatureAppRouter(handleSyncDue, {
  url: `${getAppBaseUrl()}/api/qstash/shipping/sync-due`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'shipping-sync-due' });
}
