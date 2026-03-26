import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';
import { runEbayRefreshTokensJob } from '@/lib/jobs/ebay-refresh-tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handleRefreshTokens(request: NextRequest) {
  await request.json().catch(() => ({}));
  return NextResponse.json(await runEbayRefreshTokensJob());
}

export const POST = verifySignatureAppRouter(handleRefreshTokens, {
  url: `${getAppBaseUrl()}/api/qstash/ebay/refresh-tokens`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'ebay-refresh-tokens' });
}
