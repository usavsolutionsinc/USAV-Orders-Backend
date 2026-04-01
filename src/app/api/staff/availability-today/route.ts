import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import { getCurrentStaffDayOfWeek } from '@/lib/staff-schedule';
import { getWeekStartDateKeyForDateKey } from '@/lib/staff-availability';
import { toAvailabilityResponse, type RawStaffScheduleRow } from '@/lib/staff-availability';
import { getCurrentPSTDateKey } from '@/utils/date';

function isDatabaseUnavailable(error: unknown) {
  return isTransientDbError(error);
}

function parseRoleFilter(input: string | null): Set<string> | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length) return null;
  return new Set(values);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roleFilter = parseRoleFilter(searchParams.get('roles'));
    const todayDayOfWeek = getCurrentStaffDayOfWeek();
    const todayDateKey = getCurrentPSTDateKey();
    const todayWeekStartDate = getWeekStartDateKeyForDateKey(todayDateKey);

    const sql = `
      SELECT
        s.id,
        s.name,
        s.role,
        s.active,
        s.employee_id,
        (
          COALESCE(sso.is_scheduled, swp.is_scheduled, sws.is_scheduled, true)
          AND COALESCE(sar.is_allowed, true)
        ) AS is_scheduled_today
      FROM staff s
      LEFT JOIN staff_weekly_schedule sws
        ON sws.staff_id = s.id
       AND sws.day_of_week = $1
      LEFT JOIN staff_week_plans swp
        ON swp.staff_id = s.id
       AND swp.week_start_date = $3::date
       AND swp.day_of_week = $1
      LEFT JOIN staff_schedule_overrides sso
        ON sso.staff_id = s.id
       AND sso.schedule_date = $2::date
      LEFT JOIN LATERAL (
        WITH applicable AS (
          SELECT rules.day_of_week, rules.is_allowed
          FROM staff_availability_rules rules
          WHERE rules.staff_id = s.id
            AND rules.deleted_at IS NULL
            AND rules.rule_type = 'weekday_allowed'
            AND (rules.effective_start_date IS NULL OR rules.effective_start_date <= $2::date)
            AND (rules.effective_end_date IS NULL OR rules.effective_end_date >= $2::date)
        )
        SELECT
          CASE
            WHEN EXISTS(SELECT 1 FROM applicable)
              THEN
                COALESCE((SELECT bool_or(a.is_allowed) FROM applicable a WHERE a.day_of_week = $1), false)
                AND NOT COALESCE((SELECT bool_or(NOT a.is_allowed) FROM applicable a WHERE a.day_of_week = $1), false)
            ELSE true
          END AS is_allowed
      ) sar ON true
      ORDER BY s.role ASC, s.name ASC
    `;

    let result;
    try {
        result = await queryWithRetry(
        () => pool.query(sql, [todayDayOfWeek, todayDateKey, todayWeekStartDate]),
        { retries: 3, delayMs: 1000 }
      );
    } catch (queryError: any) {
      const missingScheduleTable =
        queryError?.code === '42P01' &&
        (
          String(queryError?.message || '').includes('staff_weekly_schedule') ||
          String(queryError?.message || '').includes('staff_week_plans') ||
          String(queryError?.message || '').includes('staff_schedule_overrides') ||
          String(queryError?.message || '').includes('staff_availability_rules')
        );

      if (!missingScheduleTable) throw queryError;

      const fallbackSql = `
        SELECT
          s.id,
          s.name,
          s.role,
          s.active,
          s.employee_id,
          true AS is_scheduled_today
        FROM staff s
        ORDER BY s.role ASC, s.name ASC
      `;
      result = await queryWithRetry(
        () => pool.query(fallbackSql),
        { retries: 1, delayMs: 250 }
      );
    }

    const rows = result.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name || ''),
      role: String(row.role || ''),
      active: Boolean(row.active),
      employee_id: row.employee_id == null ? null : String(row.employee_id),
      is_scheduled_today: Boolean(row.is_scheduled_today),
    })) as RawStaffScheduleRow[];

    return NextResponse.json(toAvailabilityResponse(rows, { roleFilter: roleFilter ?? undefined }));
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json({
        timezone: 'America/Los_Angeles',
        date: '',
        dayOfWeek: 0,
        isBusinessDay: false,
        on: [],
        off: [],
        inactive: [],
        summary: {
          total: 0,
          on: 0,
          off: 0,
          inactive: 0,
          techOn: 0,
          techOff: 0,
          techInactive: 0,
          packerOn: 0,
          packerOff: 0,
          packerInactive: 0,
        },
      }, { headers: { 'x-db-fallback': 'unavailable' } });
    }

    console.error('Error fetching staff availability:', error);
    return NextResponse.json({
      error: 'Failed to fetch staff availability',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
