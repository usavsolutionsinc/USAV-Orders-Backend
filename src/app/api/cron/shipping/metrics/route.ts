/**
 * GET /api/cron/shipping/metrics
 *
 * Phase G observability. Emits one structured snapshot of carrier-tracking /
 * delivered-surface health and any derived alerts, as log lines the Vercel/
 * Datadog scrapers key off:
 *   [metrics.shipping.tracking] { ...counts }
 *   [alert.shipping.tracking]   { level, code, message, value }   (per alert)
 *
 * Pure reads — safe to run often. Auth: Vercel cron origin (CRON_SECRET).
 * Cadence (vercel.json): every 30 min.
 *
 * Tenancy: intentionally cross-org (Phase D category B). A read-only
 * observability snapshot spanning all tenants — it emits log metrics only and
 * writes nothing, so it stays a single global pass on the owner pool. (Convert
 * to a per-org rollup only if per-tenant shipping dashboards are ever needed.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isVercelCronOrigin } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import {
  collectShippingTrackingMetrics,
  detectMetricAlerts,
} from '@/lib/jobs/shipping-metrics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isVercelCronOrigin(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const locked = await withCronLock('shipping.metrics', () =>
      withCronRun('shipping.metrics', async () => {
        const metrics = await collectShippingTrackingMetrics();
        const alerts = detectMetricAlerts(metrics);
        return { metrics, alerts };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ ok: true, skipped: 'locked' });
    }
    const { metrics, alerts } = locked.result!;

    console.log('[metrics.shipping.tracking]', {
      deliveredUnscanned: metrics.deliveredUnscanned,
      blockedTotal: metrics.blockedTotal,
      uspsBlocked: metrics.uspsBlocked,
      pendingStatus: metrics.pendingStatus,
      errorStuckTotal: metrics.errorStuckTotal,
      outForDelivery: metrics.outForDelivery,
      inTransit: metrics.inTransit,
      openReceivingExceptions: metrics.openReceivingExceptions,
      unmatchedTracking: metrics.unmatchedTracking,
      perCarrier: metrics.perCarrier,
    });

    for (const alert of alerts) {
      const line = '[alert.shipping.tracking]';
      if (alert.level === 'error') console.error(line, alert);
      else console.warn(line, alert);
    }

    return NextResponse.json({ ok: true, metrics, alerts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'metrics threw';
    console.error('[cron.shipping.metrics] fatal', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
