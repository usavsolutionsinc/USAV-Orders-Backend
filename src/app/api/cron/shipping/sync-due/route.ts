/**
 * GET /api/cron/shipping/sync-due
 *
 * Vercel-cron-triggered shipping sync. Polls non-terminal shipments in
 * `shipping_tracking_numbers` and updates their carrier status (UPS, FedEx,
 * USPS) so the receiving Incoming UI reflects real-world delivery state.
 *
 * Lives here instead of the legacy `/api/qstash/shipping/sync-due` path so
 * the route name matches what actually invokes it — vercel.json `crons:`
 * entries hit this directly, no QStash queue in the loop.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel injects this header
 * automatically on every cron invocation when the env var is set). Manual
 * invocations need to pass the same header.
 *
 * Query params:
 *   - limit       — max shipments to sync this run (default 50, hard cap 200)
 *   - concurrency — parallel carrier calls (default 5, cap 10)
 *   - carriers    — comma-separated UPS,FEDEX,USPS; defaults to all
 *
 * Run cadence (per vercel.json):
 *   - every 2h: limit=100 concurrency=5 (rolling sweep)
 *   - daily 00:00 Tue–Sat: limit=200 concurrency=8 carriers=UPS,USPS,FEDEX (deep refresh)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isVercelCronOrigin } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import {
  runShippingSyncDueJob,
  normalizeShippingSyncDuePayload,
  type ShippingSyncDuePayload,
} from '@/lib/jobs/shipping-sync-due';

export const dynamic = 'force-dynamic';
// Cap at 300s — matches Vercel's default function ceiling. The scheduler
// processes shipments in `concurrency`-sized chunks so a 200-row sweep with
// concurrency=8 finishes well inside the budget.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isVercelCronOrigin(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const carriersParam = sp.getAll('carriers');
  const payload: ShippingSyncDuePayload = {
    limit: sp.get('limit') ?? undefined,
    concurrency: sp.get('concurrency') ?? undefined,
    carriers:
      carriersParam.length > 0
        ? carriersParam.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
        : undefined,
  };
  const params = normalizeShippingSyncDuePayload(payload);

  const startedAt = Date.now();
  try {
    const locked = await withCronLock('shipping.sync_due', () =>
      withCronRun('shipping.sync_due', () => runShippingSyncDueJob(payload)),
    );
    if (!locked.ran) {
      return NextResponse.json({ ok: true, skipped: 'locked' });
    }
    const result = locked.result!;

    // One structured log line — Vercel/Datadog scrapers key off the prefix
    // to plot run cadence + failure rate. Keep field names stable.
    console.log('[cron.shipping.sync-due]', {
      ok: result.ok,
      limit: params.limit,
      concurrency: params.concurrency,
      carriers: params.carriers ?? 'all',
      synced: result.synced,
      terminal: result.terminal,
      errors: result.errors,
      durationMs: result.durationMs,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'shipping sync threw';
    console.error('[cron.shipping.sync-due] fatal', { message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
