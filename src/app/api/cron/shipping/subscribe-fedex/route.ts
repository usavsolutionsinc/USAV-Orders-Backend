/**
 * GET /api/cron/shipping/subscribe-fedex
 *
 * Associates FedEx tracking numbers to our Advanced Integrated Visibility
 * webhook project so FedEx pushes near-real-time track events to
 * /api/webhooks/fedex. Without this association no events are pushed and the
 * UI falls back to the (slower) polling sweep — the root cause of stale
 * "label created" statuses.
 *
 * Two passes per run (see runFedExSubscribeJob): associate pending shipments in
 * a ≤1000 batch, then reconcile outstanding async jobs to COMPLETED/FAILED.
 * Handles both the one-time backfill and steady-state new shipments.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel injects this on cron
 * invocations). Mirrors /api/cron/shipping/sync-due.
 *
 * Query params:
 *   - limit    — max shipments to associate this run (default/cap 1000)
 *   - jobLimit — max outstanding jobs to reconcile this run (default 25)
 *
 * Run cadence (per vercel.json): every 15 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isVercelCronOrigin } from '@/lib/cron/auth';
import {
  runFedExSubscribeJob,
  normalizeFedExSubscribePayload,
  type FedExSubscribePayload,
} from '@/lib/jobs/fedex-subscribe-pending';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isVercelCronOrigin(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const payload: FedExSubscribePayload = {
    limit: sp.get('limit') ?? undefined,
    jobLimit: sp.get('jobLimit') ?? undefined,
  };
  const params = normalizeFedExSubscribePayload(payload);

  const startedAt = Date.now();
  try {
    const result = await runFedExSubscribeJob(payload);

    console.log('[cron.shipping.subscribe-fedex]', {
      ok: result.ok,
      limit: params.limit,
      jobLimit: params.jobLimit,
      submitted: result.submitted,
      completed: result.completed,
      failed: result.failed,
      jobsReconciled: result.jobsReconciled,
      durationMs: result.durationMs,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fedex subscribe threw';
    console.error('[cron.shipping.subscribe-fedex] fatal', {
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
