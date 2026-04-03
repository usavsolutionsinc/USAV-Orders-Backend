import { NextResponse } from 'next/server';
import { getQStashClient } from '@/lib/qstash';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getQStashClient();

    const [schedules, logsRes] = await Promise.all([
      client.schedules.list(),
      client.logs({ count: 200 }),
    ]);

    const logs = (logsRes.logs ?? logsRes.events ?? []).map((log) => ({
      time: log.time,
      state: log.state,
      messageId: log.messageId,
      url: log.url,
      label: log.label ?? null,
      error: log.error ?? null,
    }));

    const scheduleRows = schedules.map((s) => ({
      scheduleId: s.scheduleId,
      cron: s.cron,
      destination: s.destination,
      method: s.method,
      retries: s.retries,
      isPaused: s.isPaused,
      createdAt: s.createdAt,
    }));

    return NextResponse.json({ success: true, schedules: scheduleRows, logs });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch QStash status' },
      { status: 500 },
    );
  }
}
