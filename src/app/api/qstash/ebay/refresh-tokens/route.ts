import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest, isQStashOrigin } from '@/lib/qstash';
import { runEbayRefreshTokensJob } from '@/lib/jobs/ebay-refresh-tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function execute() {
  try {
    return NextResponse.json(await runEbayRefreshTokensJob());
  } catch (error: any) {
    console.error('[ebay/refresh-tokens]', error);
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
  return execute();
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ ok: true, queue: 'vercel-cron', job: 'ebay-refresh-tokens' });
  }
  return execute();
}
