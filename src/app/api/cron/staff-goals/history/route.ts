import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runStaffGoalHistorySnapshotJob } from '@/lib/jobs/staff-goal-history-snapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/cron/staff-goals/history  (Vercel cron, daily 00:30) */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('staff_goals.history', () =>
      withCronRun('staff_goals.history', () => runStaffGoalHistorySnapshotJob({})),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const result = locked.result!;
    console.log('[staff-goals/history] Completed', result);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[staff-goals/history]', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}
