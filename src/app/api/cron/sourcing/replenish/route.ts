import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest, isQStashOrigin } from '@/lib/qstash';
import { runReplenishmentWatch } from '@/lib/jobs/replenishment-watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST/GET /api/cron/sourcing/replenish
 *
 * Runs runReplenishmentWatch — for each SKU enrolled in a live `replenish`
 * alert (auto-added at pack-out) that has a target price, searches eBay and
 * escalates the alert + saves candidates when a listing lands at/below target.
 *
 * POST: QStash-signed origin. GET: Vercel-cron / authorized origin; an
 * unauthorized GET returns a harmless heartbeat instead of running the job.
 */
export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runWatch();
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ ok: true, queue: 'vercel-cron', job: 'sourcing-replenish' });
  }
  return runWatch();
}

async function runWatch() {
  try {
    const result = await runReplenishmentWatch();
    console.log('[cron.sourcing.replenish]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[cron.sourcing.replenish] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Replenish watch failed' },
      { status: 500 },
    );
  }
}
