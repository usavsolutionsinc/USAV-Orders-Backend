import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runSignalInsightRollup } from '@/lib/operations/signal-rollup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'insights.signal_rollup';

/**
 * GET /api/cron/signal-insight-rollup  (Vercel cron, nightly)
 *
 * Rolls each org's entity_signals into per-org insight_links rows so the
 * assistant + "you vs typical" readout can show the operation's OWN reason-code
 * distribution alongside the seeded typicals (universal-feed plan Phase 5
 * learning loop). Idempotent per (org, signal_kind).
 *
 * Tenancy (global, org-preserving — same posture as workflow-node-stats): the
 * domain fn runs one set-based INSERT…SELECT that reads each row's
 * entity_signals.organization_id and STAMPS the same org on its output row, so
 * it never misroutes to one tenant. Runs cross-org on the owner pool.
 *
 * `?windowDays=` overrides the trailing window (default 30, clamped 1–365).
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const windowParam = Number(request.nextUrl.searchParams.get('windowDays'));
  const windowDays = Number.isFinite(windowParam) && windowParam > 0 ? windowParam : 30;

  try {
    const locked = await withCronLock(JOB, () =>
      withCronRun(JOB, () => runSignalInsightRollup(windowDays)),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    return NextResponse.json(locked.result!); // already { success: true, rowsWritten, windowDays }
  } catch (error) {
    console.error('[signal-insight-rollup]', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
