import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import { STAFF_SCHEDULE_TIMEZONE, getCurrentStaffDayOfWeek } from '@/lib/staff-schedule';

interface ScheduleRow {
  staff_id: number;
  day_of_week: number;
  is_scheduled: boolean;
}

function isDatabaseUnavailable(error: unknown) {
  return isTransientDbError(error);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') !== 'false';

    const sql = `
      SELECT
        s.id AS staff_id,
        d.day_of_week::int AS day_of_week,
        COALESCE(sws.is_scheduled, true) AS is_scheduled
      FROM staff s
      CROSS JOIN generate_series(0, 6) AS d(day_of_week)
      LEFT JOIN staff_weekly_schedule sws
        ON sws.staff_id = s.id
       AND sws.day_of_week = d.day_of_week
      ${includeInactive ? '' : 'WHERE s.active = true'}
      ORDER BY s.id ASC, d.day_of_week ASC
    `;

    const result = await queryWithRetry(
      () => pool.query(sql),
      { retries: 3, delayMs: 1000 }
    );

    const schedules: ScheduleRow[] = result.rows.map((row) => ({
      staff_id: Number(row.staff_id),
      day_of_week: Number(row.day_of_week),
      is_scheduled: Boolean(row.is_scheduled),
    }));

    return NextResponse.json({
      timezone: STAFF_SCHEDULE_TIMEZONE,
      today_day_of_week: getCurrentStaffDayOfWeek(),
      schedules,
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      console.warn('Staff schedule DB unavailable (GET):', error instanceof Error ? error.message : String(error));
      return NextResponse.json({
        timezone: STAFF_SCHEDULE_TIMEZONE,
        today_day_of_week: getCurrentStaffDayOfWeek(),
        schedules: [],
      }, { headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error fetching staff schedule:', error);
    return NextResponse.json({
      error: 'Failed to fetch staff schedule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const staffId = Number(body?.staffId);
    const dayOfWeek = Number(body?.dayOfWeek);
    const isScheduledRaw = body?.isScheduled;

    if (!Number.isFinite(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'Valid staffId is required' }, { status: 400 });
    }
    if (!Number.isFinite(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return NextResponse.json({ error: 'dayOfWeek must be an integer between 0 and 6' }, { status: 400 });
    }
    if (typeof isScheduledRaw !== 'boolean') {
      return NextResponse.json({ error: 'isScheduled must be boolean' }, { status: 400 });
    }
    const isScheduled = isScheduledRaw;

    const sql = `
      INSERT INTO staff_weekly_schedule (staff_id, day_of_week, is_scheduled, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (staff_id, day_of_week)
      DO UPDATE SET
        is_scheduled = EXCLUDED.is_scheduled,
        updated_at = now()
      RETURNING staff_id, day_of_week, is_scheduled
    `;

    const result = await queryWithRetry(
      () => pool.query(sql, [staffId, dayOfWeek, isScheduled]),
      { retries: 3, delayMs: 1000 }
    );

    await invalidateCacheTags(['staff']);
    return NextResponse.json(result.rows[0] ?? {
      staff_id: staffId,
      day_of_week: dayOfWeek,
      is_scheduled: isScheduled,
    });
  } catch (error) {
    console.error('Error updating staff schedule:', error);
    return NextResponse.json({
      error: 'Failed to update staff schedule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
