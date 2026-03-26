import { NextRequest, NextResponse } from 'next/server';
import { runEbayRefreshTokensJob } from '@/lib/jobs/ebay-refresh-tokens';
import { logRouteMetric } from '@/lib/route-metrics';

/**
 * POST /api/ebay/refresh-tokens
 * Worker endpoint: refreshes all eBay accounts whose token expires within 30 minutes.
 * Intended for internal calls and QStash wrappers.
 */
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let ok = false;
  try {
    const result = await runEbayRefreshTokensJob();
    ok = true;
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[ebay/refresh-tokens]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  } finally {
    logRouteMetric({
      route: '/api/ebay/refresh-tokens',
      method: 'POST',
      startedAt,
      ok,
    });
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST via the QStash worker route.' },
    { status: 405 }
  );
}
