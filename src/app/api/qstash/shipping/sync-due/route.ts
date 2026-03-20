import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handleSyncDue(request: NextRequest) {
  const baseUrl = getAppBaseUrl();
  const url = `${baseUrl}/api/shipping/track/sync-due`;
  const payload = await request.json().catch(() => ({}));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
