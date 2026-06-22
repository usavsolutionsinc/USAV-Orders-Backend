/**
 * GET /api/cron/shipping/reconcile-delivered
 *
 * Phase F2 reconcile guard. Re-derives carrier delivered-state from the
 * append-only event log and frees error-stuck shipments for another poll —
 * the ongoing version of the F1 backfill. Pure SQL, no carrier API calls.
 *
 * Catches the two drift modes the poll path can leave behind:
 *   - a DELIVERED event logged but is_delivered never set (failed summary write),
 *     which can then get stranded behind consecutive_error_count >= 5;
 *   - rows permanently skipped by getDueShipments after hitting the error cutoff.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel injects on cron runs;
 * manual invocations must pass the same header).
 *
 * Cadence (vercel.json): hourly — cheap, and keeps the delivered surface honest
 * between the 15-min carrier sweeps.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isVercelCronOrigin } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runReconcileDeliveredJob } from '@/lib/jobs/reconcile-delivered';
import { runTrackingMatchReconcileJob } from '@/lib/jobs/tracking-match-reconcile';
import { runWarrantyClockMaintenance } from '@/lib/warranty/clock-sweep';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!isVercelCronOrigin(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const locked = await withCronLock('shipping.reconcile_delivered', () =>
      withCronRun('shipping.reconcile_delivered', async () => {
        // Two pure-SQL reconcile passes: delivered-from-log (F2) and tracking↔
        // receiving match reliability (Phase D). Independent — run both, fold the
        // results. A match failure must not mask a delivered reconcile, so guard it.
        const delivered = await runReconcileDeliveredJob();

        let match: Awaited<ReturnType<typeof runTrackingMatchReconcileJob>> | { ok: false; error: string };
        try {
          match = await runTrackingMatchReconcileJob();
        } catch (err) {
          match = { ok: false, error: err instanceof Error ? err.message : 'match reconcile threw' };
        }

        // Warranty clock maintenance piggybacks here: now that delivered-state is
        // fresh, re-derive provisional warranty windows onto real delivered dates and
        // expire lapsed claims. Guarded + flag-gated — never breaks the shipping pass.
        let warranty: Awaited<ReturnType<typeof runWarrantyClockMaintenance>> | { skipped: false; error: string };
        try {
          warranty = await runWarrantyClockMaintenance();
        } catch (err) {
          warranty = { skipped: false, error: err instanceof Error ? err.message : 'warranty maintenance threw' };
        }

        return { delivered, match, warranty };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ ok: true, skipped: 'locked' });
    }
    const { delivered, match, warranty } = locked.result!;

    console.log('[cron.shipping.reconcile-delivered]', {
      delivered: {
        deliveredReconciled: delivered.deliveredReconciled,
        scanDelivered: delivered.scanDelivered,
        coherenceFixed: delivered.coherenceFixed,
        erroredRecovered: delivered.erroredRecovered,
        durationMs: delivered.durationMs,
      },
      match,
      warranty,
    });
    return NextResponse.json({ ok: true, delivered, match, warranty });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reconcile threw';
    console.error('[cron.shipping.reconcile-delivered] fatal', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
