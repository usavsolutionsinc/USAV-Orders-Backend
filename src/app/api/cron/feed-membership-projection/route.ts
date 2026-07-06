import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { projectReceivingTriageMemberships } from '@/lib/receiving/feed-membership-projection';
import { projectOrdersUnshippedMemberships } from '@/lib/orders/feed-membership-projection';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'feed_memberships.projection';

/**
 * GET /api/cron/feed-membership-projection  (Vercel cron, every 10 min)
 *
 * Projects the current receiving-triage queue AND the unshipped-orders queue
 * into feed_memberships so the shared read substrate (the AI's getFeedState, and
 * a paginated dashboard read later) reflects reality (universal-feed plan Phase 4
 * + unshipped-dashboard-performance plan Phase 5). Idempotent per entity;
 * org-preserving on the owner pool. The orders projector computes each order's
 * fulfillment lane in Node (Decision 8) and stores it in `state`.
 *
 * `?windowDays=` overrides the arrival window (default 90, clamped 1–365).
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const windowParam = Number(request.nextUrl.searchParams.get('windowDays'));
  const windowDays = Number.isFinite(windowParam) && windowParam > 0 ? windowParam : 90;

  try {
    const locked = await withCronLock(JOB, () =>
      withCronRun(JOB, async () => {
        const receiving = await projectReceivingTriageMemberships(windowDays);
        const orders = await projectOrdersUnshippedMemberships(windowDays);
        return { receiving, orders };
      }),
    );
    if (!locked.ran) return NextResponse.json({ success: true, skipped: 'locked' });
    return NextResponse.json(locked.result!);
  } catch (error) {
    console.error('[feed-membership-projection]', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
