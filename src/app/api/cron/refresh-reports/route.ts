import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/cron/refresh-reports
 * Nightly REFRESH MATERIALIZED VIEW pass. Each view has a unique pkey index
 * so CONCURRENTLY refreshes don't block reads.
 */
export async function GET(_req: NextRequest) {
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
