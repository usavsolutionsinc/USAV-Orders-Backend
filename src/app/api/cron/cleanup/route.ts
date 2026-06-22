import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runIdempotencyCleanup } from '@/lib/jobs/idempotency-cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_RUNS_RETENTION_DAYS = 30;

/**
 * GET /api/cron/cleanup  (Vercel cron, daily)
 *
 * Housekeeping: prune the api_idempotency_responses cache and the cron_runs
 * history (keep ~30 days). Replaces the orphaned /api/qstash/cleanup/idempotency.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('cleanup', () =>
      withCronRun('cleanup', async () => {
        const idempotency = await runIdempotencyCleanup();
        const runs = await pool.query(
          `DELETE FROM cron_runs WHERE started_at < NOW() - ($1::int * INTERVAL '1 day')`,
          [CRON_RUNS_RETENTION_DAYS],
        );
        return {
          idempotency_deleted: idempotency.deletedRows,
          cron_runs_deleted: runs.rowCount ?? 0,
        };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const summary = locked.result!;
    console.log('[cron.cleanup]', summary);
    return NextResponse.json({ success: true, ...summary });
  } catch (error: any) {
    console.error('[cron/cleanup]', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}
