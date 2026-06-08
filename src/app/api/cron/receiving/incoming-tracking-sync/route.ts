/**
 * GET /api/cron/receiving/incoming-tracking-sync  (Vercel cron, every 15 min)
 *
 * Proactive twin of the Incoming "Tracking" button. Re-polls carriers for the
 * exact shipment set backing the Incoming receiving table (via the shared
 * {@link selectIncomingShipmentIds}) so "Delivered · not scanned" stays fresh
 * without anyone clicking. Complements /api/cron/shipping/sync-due, which
 * sweeps *all* shipments slowly — this keeps the *visible* set current.
 *
 * No operator cooldown / rate-limit (those are UI concerns); just the batch
 * cap to stay inside the function budget.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { selectIncomingShipmentIds } from '@/lib/receiving/incoming-shipments';
import { syncShipmentsByIds } from '@/lib/shipping/scheduler';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH_CAP = 250;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await withCronRun('receiving.incoming_tracking', async () => {
      const rows = await selectIncomingShipmentIds(BATCH_CAP);
      const capped = rows.length > BATCH_CAP;
      const batch = rows.slice(0, BATCH_CAP);
      const result = await syncShipmentsByIds(batch, { concurrency: 5 });

      if (result.terminal > 0 || result.synced > 0) {
        try {
          await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
        } catch {
          /* non-fatal */
        }
      }

      return {
        scanned: batch.length,
        delivered: result.terminal,
        updated: result.synced,
        errors: result.errors,
        capped,
      };
    });

    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'incoming tracking sync failed';
    console.error('[cron.receiving.incoming-tracking-sync] fatal', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
