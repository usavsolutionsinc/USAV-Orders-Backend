import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { runReplenishmentWatch } from '@/lib/jobs/replenishment-watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/sourcing/replenish  (Vercel cron, daily)
 *
 * Runs runReplenishmentWatch — for each SKU enrolled in a live `replenish`
 * alert (auto-added at pack-out) that has a target price, searches eBay and
 * escalates the alert + saves candidates when a listing lands at/below target.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await withCronRun('sourcing.replenish', runReplenishmentWatch);
    console.log('[cron.sourcing.replenish]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Replenish watch failed';
    console.error('[cron.sourcing.replenish] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
