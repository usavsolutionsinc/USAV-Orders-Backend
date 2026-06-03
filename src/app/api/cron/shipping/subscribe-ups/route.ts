/**
 * GET /api/cron/shipping/subscribe-ups
 *
 * Subscribes UPS tracking numbers for near-real-time push to /api/webhooks/ups
 * (UPS Track Alert lineage). Synchronous per-batch — no async job to reconcile.
 *
 * ⚠️ UPS push for *third-party* tracking numbers (numbers not on our own UPS
 * account) is unconfirmed and may be unsupported — see ups-subscription.ts. If
 * UPS rejects them, this cron is a harmless no-op and polling remains the path.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel injects on cron runs).
 * Mirrors /api/cron/shipping/subscribe-fedex.
 *
 * Query params:
 *   - limit — max shipments to subscribe this run (default/cap one UPS batch)
 *
 * Run cadence (per vercel.json): every 15 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isVercelCronOrigin } from '@/lib/qstash';
import {
  runUpsSubscribeJob,
  normalizeUpsSubscribePayload,
  type UpsSubscribePayload,
} from '@/lib/jobs/ups-subscribe-pending';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isVercelCronOrigin(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const payload: UpsSubscribePayload = { limit: sp.get('limit') ?? undefined };
  const params = normalizeUpsSubscribePayload(payload);

  const startedAt = Date.now();
  try {
    const result = await runUpsSubscribeJob(payload);

    console.log('[cron.shipping.subscribe-ups]', {
      ok: result.ok,
      limit: params.limit,
      completed: result.completed,
      failed: result.failed,
      durationMs: result.durationMs,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ups subscribe threw';
    console.error('[cron.shipping.subscribe-ups] fatal', {
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
