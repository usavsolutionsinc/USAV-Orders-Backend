/**
 * GET /api/cron/shipping/subscribe-usps
 *
 * Subscribes USPS tracking numbers for near-real-time push to /api/webhooks/usps
 * (USPS Tracking 3.2 webhook subscriptions, free, third-party numbers supported)
 * and renews subscriptions past their TTL. Synchronous per-number — no async job.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel injects on cron runs).
 * Mirrors /api/cron/shipping/subscribe-fedex and subscribe-ups.
 *
 * Query params:
 *   - limit — max shipments to (re)subscribe this run (default/cap one USPS batch)
 *
 * Run cadence (per vercel.json): every 15 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isVercelCronOrigin } from '@/lib/cron/auth';
import {
  runUspsSubscribeJob,
  normalizeUspsSubscribePayload,
  type UspsSubscribePayload,
} from '@/lib/jobs/usps-subscribe-pending';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isVercelCronOrigin(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const payload: UspsSubscribePayload = { limit: sp.get('limit') ?? undefined };
  const params = normalizeUspsSubscribePayload(payload);

  const startedAt = Date.now();
  try {
    const result = await runUspsSubscribeJob(payload);

    console.log('[cron.shipping.subscribe-usps]', {
      ok: result.ok,
      limit: params.limit,
      completed: result.completed,
      failed: result.failed,
      renewed: result.renewed,
      durationMs: result.durationMs,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'usps subscribe threw';
    console.error('[cron.shipping.subscribe-usps] fatal', {
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
