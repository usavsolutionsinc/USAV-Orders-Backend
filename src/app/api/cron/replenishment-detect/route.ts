import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { isInventoryV2Replenishment } from '@/lib/feature-flags';
import { detectReplenishmentNeeds } from '@/lib/replenishment/pick-face';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/cron/replenishment-detect
 *
 * Scans PICK_FACE bins where `qty < min_qty` and inserts REQUESTED rows in
 * `replenishment_tasks` for each one. Triggered by QStash on a schedule
 * (configure in src/config/qstash-schedules.json once the workflow lands).
 *
 * Idempotent — the partial UNIQUE on (sku, to_bin_id) WHERE status IN
 * ('REQUESTED','IN_PROGRESS') silently dedupes re-runs.
 *
 * Gated by INVENTORY_V2_REPLENISHMENT. Off-flag returns 503 so the QStash
 * schedule fails fast instead of half-running.
 */
export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isInventoryV2Replenishment()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_REPLENISHMENT flag is OFF', flag: 'INVENTORY_V2_REPLENISHMENT' },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await detectReplenishmentNeeds();
    return NextResponse.json({
      ok: true,
      job: 'replenishment-detect',
      durationMs: Date.now() - startedAt,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'detection failed';
    console.error('[cron/replenishment-detect] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Health probe — no auth required. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    queue: 'qstash',
    job: 'replenishment-detect',
    flag: 'INVENTORY_V2_REPLENISHMENT',
  });
}
