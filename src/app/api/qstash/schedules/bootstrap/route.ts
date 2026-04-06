import { NextRequest, NextResponse } from 'next/server';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import qstashSchedules from '@/config/qstash-schedules.json';
import { getQStashClient, upsertQStashSchedule } from '@/lib/qstash';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  return isAllowedAdminOrigin(req);
}

const HEAVY_JOB_SCHEDULES = qstashSchedules as Array<{
  scheduleId: string;
  cron: string;
  path: string;
  body: Record<string, unknown>;
  label: string;
  retries?: number;
  timeout?: number;
  headers?: Record<string, string>;
}>;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getQStashClient();
    const existingSchedules = await client.schedules.list();
    const expectedIds = new Set(HEAVY_JOB_SCHEDULES.map((schedule) => schedule.scheduleId));
    const obsoleteSchedules = existingSchedules.filter(
      (schedule) => !expectedIds.has(String(schedule.scheduleId)),
    );

    if (obsoleteSchedules.length > 0) {
      await Promise.all(
        obsoleteSchedules.map((schedule) => client.schedules.delete(String(schedule.scheduleId))),
      );
    }

    const results = await Promise.all(
      HEAVY_JOB_SCHEDULES.map(async ({ headers, ...schedule }) => {
        const result = await upsertQStashSchedule({ ...schedule, headers });
        return { ...schedule, ...result };
      })
    );

    return NextResponse.json({
      success: true,
      schedules: results,
      deletedScheduleIds: obsoleteSchedules.map((schedule) => String(schedule.scheduleId)),
      count: results.length,
    });
  } catch (error: any) {
    console.error('[qstash/schedules/bootstrap]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to bootstrap schedules' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
