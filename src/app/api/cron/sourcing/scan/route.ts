import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runSourcingScanJob } from '@/lib/jobs/sourcing-scan';
import {
  runSourcingDemandCollectorsJob,
  DEMAND_CAP_PER_ORG,
} from '@/lib/jobs/sourcing-demand-collectors';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/sourcing/scan  (Vercel cron, daily)
 *
 * Runs runSourcingScanJob — turns lifecycle + stock conditions into the
 * sourcing_alerts auto-flag queue and resolves cleared alerts — then the
 * demand collectors (missing-parts / repair / warranty / pending-SKU /
 * replenishment shortfall) behind a per-org size guard (DEMAND_CAP_PER_ORG;
 * dropped counts are logged + returned, never silent). Both halves are
 * idempotent (live partial unique indexes), so re-running is safe.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('sourcing.scan', () =>
      withCronRun('sourcing.scan', async () => {
        const scan = await runSourcingScanJob();
        const demand = await runSourcingDemandCollectorsJob({ capPerOrg: DEMAND_CAP_PER_ORG });
        return { ...scan, demand };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const result = locked.result!;
    console.log('[cron.sourcing.scan]', JSON.stringify(result));
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sourcing scan failed';
    console.error('[cron.sourcing.scan] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
