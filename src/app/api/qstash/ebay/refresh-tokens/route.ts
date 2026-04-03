import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { runEbayRefreshTokensJob } from '@/lib/jobs/ebay-refresh-tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handleRefreshTokens(request: NextRequest) {
  await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await runEbayRefreshTokensJob());
  } catch (error: any) {
    console.error('[qstash/ebay/refresh-tokens]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

export const POST = verifySignatureAppRouter(handleRefreshTokens);

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'ebay-refresh-tokens' });
}
