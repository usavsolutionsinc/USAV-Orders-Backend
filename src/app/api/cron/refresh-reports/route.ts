import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/cron/refresh-reports  (Vercel cron, daily)
 * Nightly REFRESH MATERIALIZED VIEW pass. Each view has a unique pkey index
 * so CONCURRENTLY refreshes don't block reads.
 *
 * Tenancy: intentionally GLOBAL / cross-org (Phase D category B). These MVs
 * aggregate across all orgs and REFRESH MATERIALIZED VIEW requires the
 * privileged role, so this stays on the owner pool — never a per-org tenant
 * sweep. Phase E follow-up: the MVs must gain an organization_id column (or go
 * per-org) before the tenant role can own them.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('refresh_reports', () =>
      withCronRun('refresh_reports', execute),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const summary = locked.result!;
    return NextResponse.json({ success: summary.failed.length === 0, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'refresh failed';
    console.error('[cron/refresh-reports] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function execute() {
  const startedAt = Date.now();
  const refreshed: string[] = [];
  const failed: Array<{ view: string; error: string }> = [];

  for (const view of ['mv_bin_utilization', 'mv_sku_velocity_30d', 'mv_dead_stock']) {
    try {
      await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
      refreshed.push(view);
    } catch (err) {
      failed.push({ view, error: err instanceof Error ? err.message : 'refresh failed' });
    }
  }

  return { refreshed, failed, elapsed_ms: Date.now() - startedAt };
}
