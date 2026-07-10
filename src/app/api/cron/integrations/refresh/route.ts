/**
 * GET /api/cron/integrations/refresh — proactive token refresh sweep (INT-010).
 *
 * Rotates OAuth tokens for every active vault connection whose expires_at
 * falls within the look-ahead window (default 60 min; override with
 * ?thresholdMinutes=N) by calling the provider connector's refresh(). A clean
 * no-op until the 2026-07-09d operational-columns migration is applied.
 * Auth via Bearer CRON_SECRET, mirroring the sibling integrations crons.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runTokenRefreshSweep } from '@/lib/integrations/connectors/refresh-sweep';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const thresholdParam = Number(req.nextUrl.searchParams.get('thresholdMinutes'));
  const thresholdMinutes =
    Number.isFinite(thresholdParam) && thresholdParam > 0 ? thresholdParam : undefined;

  const locked = await withCronLock('integrations.token_refresh', () =>
    withCronRun('integrations.token_refresh', async () => {
      const { scanned, refreshed, skipped, failures, attempts } = await runTokenRefreshSweep({
        thresholdMinutes,
      });
      return { scanned, refreshed, skipped, failures, attempts };
    }),
  );
  if (!locked.ran) {
    return NextResponse.json({ ok: true, skipped: 'locked' });
  }
  const summary = locked.result!;
  return NextResponse.json({ ok: true, summary });
}
