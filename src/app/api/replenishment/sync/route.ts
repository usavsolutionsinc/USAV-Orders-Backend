import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withCronRun } from '@/lib/cron/run-log';
import { runReplenishmentSync } from '@/lib/replenishment';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/replenishment/sync
 *
 * Operator-triggered replenishment sync (the /replenish sidebar button).
 * Same job the daily cron (/api/cron/replenishment/sync) runs; logged as a
 * manual run in cron_runs.
 */
export const POST = withAuth(async (_req, ctx) => {
  try {
    await withCronRun('replenishment.sync', async () => {
      await runReplenishmentSync(ctx.organizationId);
      return { ok: true };
    }, { trigger: 'manual' });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[replenishment/sync]', error);
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
  }
}, { permission: 'replenish.create_po' });
