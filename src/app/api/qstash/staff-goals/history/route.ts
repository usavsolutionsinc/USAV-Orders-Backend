import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import {
  runStaffGoalHistorySnapshotJob,
  type StaffGoalHistorySnapshotPayload,
} from '@/lib/jobs/staff-goal-history-snapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as StaffGoalHistorySnapshotPayload;
    const result = await runStaffGoalHistorySnapshotJob(body);
    console.log('[qstash/staff-goals/history] Completed', result);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[qstash/staff-goals/history]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'staff-goal-history-snapshot' });
}
