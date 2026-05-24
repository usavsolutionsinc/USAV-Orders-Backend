import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAuthorizedCronRequest, isQStashOrigin } from '@/lib/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/cron/refresh-reports
 * Nightly REFRESH MATERIALIZED VIEW pass. Each view has a unique pkey index
 * so CONCURRENTLY refreshes don't block reads.
 *
 * Triggered by QStash on a daily schedule (see src/config/qstash-schedules.json).
 * Previously a Vercel cron — migrated 2026-05-18 to avoid Vercel cron billing.
 */
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

  return NextResponse.json({
    success: failed.length === 0,
    refreshed,
    failed,
    elapsed_ms: Date.now() - startedAt,
  });
}

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return execute();
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ ok: true, queue: 'vercel-cron', job: 'refresh-reports' });
  }
  return execute();
}
