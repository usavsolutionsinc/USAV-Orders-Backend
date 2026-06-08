import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { runReplenishmentSync } from '@/lib/replenishment';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/cron/replenishment/sync  (Vercel cron, daily 13:00) */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await withCronRun('replenishment.sync', async () => {
      await runReplenishmentSync();
      return { ok: true };
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[replenishment/sync]', error);
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
  }
}
