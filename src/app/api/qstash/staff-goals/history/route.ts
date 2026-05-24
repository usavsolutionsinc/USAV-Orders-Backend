import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest, isQStashOrigin } from '@/lib/qstash';
import {
  runStaffGoalHistorySnapshotJob,
  type StaffGoalHistorySnapshotPayload,
} from '@/lib/jobs/staff-goal-history-snapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function execute(body: StaffGoalHistorySnapshotPayload) {
  try {
    const result = await runStaffGoalHistorySnapshotJob(body);
    console.log('[staff-goals/history] Completed', result);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[staff-goals/history]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as StaffGoalHistorySnapshotPayload;
  return execute(body);
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ ok: true, queue: 'vercel-cron', job: 'staff-goal-history-snapshot' });
  }
  return execute({});
}
