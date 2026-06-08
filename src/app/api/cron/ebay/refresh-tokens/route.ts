import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { runEbayRefreshTokensJob } from '@/lib/jobs/ebay-refresh-tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/cron/ebay/refresh-tokens  (Vercel cron, hourly) */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await withCronRun('ebay.refresh_tokens', runEbayRefreshTokensJob);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[ebay/refresh-tokens]', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}
