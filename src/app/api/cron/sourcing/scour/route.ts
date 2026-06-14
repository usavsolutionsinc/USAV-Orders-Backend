import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { runScourWatch } from '@/lib/jobs/scour-watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/sourcing/scour  (Vercel cron, daily)
 *
 * Runs runScourWatch — re-runs every due standing (saved) sourcing search across
 * the enabled channels and saves the hits to the watchlist. Cadence windows in
 * getDueSourcingSearches keep each search to roughly its daily/weekly rate.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await withCronRun('sourcing.scour', runScourWatch);
    console.log('[cron.sourcing.scour]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scour watch failed';
    console.error('[cron.sourcing.scour] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
