import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handleRefreshTokens(request: NextRequest) {
  const baseUrl = getAppBaseUrl();
  const cronSecret = process.env.CRON_SECRET;
  const url = `${baseUrl}/api/ebay/refresh-tokens`;

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

export const POST = verifySignatureAppRouter(handleRefreshTokens, {
  url: `${getAppBaseUrl()}/api/qstash/ebay/refresh-tokens`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'ebay-refresh-tokens' });
}
