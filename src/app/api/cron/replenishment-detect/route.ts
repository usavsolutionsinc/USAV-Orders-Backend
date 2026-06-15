import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { detectReplenishmentNeeds } from '@/lib/replenishment/pick-face';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/replenishment-detect  (Vercel cron, every 4h)
 *
 * Scans PICK_FACE bins where `qty < min_qty` and inserts REQUESTED rows in
 * `replenishment_tasks` for each one. Idempotent — the partial UNIQUE on
 * (sku, to_bin_id) WHERE status IN ('REQUESTED','IN_PROGRESS') dedupes re-runs.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await withCronRun('replenishment.detect', async () => {
      const startedAt = Date.now();
      const r = await detectReplenishmentNeeds();
      return { job: 'replenishment-detect', durationMs: Date.now() - startedAt, ...r };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'detection failed';
    console.error('[cron/replenishment-detect] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
