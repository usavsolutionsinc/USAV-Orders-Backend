import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest, isQStashOrigin } from '@/lib/qstash';
import { runSourcingScanJob } from '@/lib/jobs/sourcing-scan';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST/GET /api/cron/sourcing/scan
 *
 * Runs runSourcingScanJob — turns lifecycle + stock conditions into the
 * sourcing_alerts auto-flag queue and resolves cleared alerts. Idempotent
 * (partial unique index), so re-running is safe.
 *
 * POST: QStash-signed origin. GET: Vercel-cron / authorized origin; an
 * unauthorized GET returns a harmless heartbeat rather than running the job.
 */
export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runScan();
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ ok: true, queue: 'vercel-cron', job: 'sourcing-scan' });
  }
  return runScan();
}

async function runScan() {
  try {
    const result = await runSourcingScanJob();
    console.log('[cron.sourcing.scan]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[cron.sourcing.scan] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Sourcing scan failed' },
      { status: 500 },
    );
  }
}
