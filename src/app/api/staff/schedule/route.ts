import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import { STAFF_SCHEDULE_TIMEZONE, getCurrentStaffDayOfWeek } from '@/lib/staff-schedule';
import { publishStaffScheduleChanged } from '@/lib/realtime/publish';
import { getStaffAvailabilityDecision, isMissingAvailabilityRulesTable } from '@/lib/staff-availability-rules';

interface ScheduleRow {
  staff_id: number;
  day_of_week: number;
  is_scheduled: boolean;
  schedule_date?: string;
}

function isDatabaseUnavailable(error: unknown) {
  return isTransientDbError(error);
}

function isMissingScheduleTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === '42P01' && (
    String(e?.message || '').includes('staff_weekly_schedule') ||
    String(e?.message || '').includes('staff_week_plans') ||
    String(e?.message || '').includes('staff_schedule_overrides') ||
    String(e?.message || '').includes('staff_availability_rules')
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  const e = error as { code?: string } | null;
  return e?.code === '23503';
}

function isValidIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') !== 'false';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (isValidIsoDate(startDate) && isValidIsoDate(endDate)) {
      const sqlByDate = `
        SELECT
          s.id AS staff_id,
          d.schedule_date::date::text AS schedule_date,
          EXTRACT(DOW FROM d.schedule_date)::int AS day_of_week,
          (
            COALESCE(sso.is_scheduled, swp.is_scheduled, sws.is_scheduled, true)
            AND COALESCE(sar.is_allowed, true)
          ) AS is_scheduled
        FROM staff s
        CROSS JOIN generate_series($1::date, $2::date, '1 day'::interval) AS d(schedule_date)
        LEFT JOIN staff_weekly_schedule sws
          ON sws.staff_id = s.id
         AND sws.day_of_week = EXTRACT(DOW FROM d.schedule_date)::int
        LEFT JOIN staff_week_plans swp
          ON swp.staff_id = s.id
         AND swp.week_start_date = DATE_TRUNC('week', d.schedule_date)::date
         AND swp.day_of_week = EXTRACT(DOW FROM d.schedule_date)::int
        LEFT JOIN staff_schedule_overrides sso
          ON sso.staff_id = s.id
         AND sso.schedule_date = d.schedule_date::date
        LEFT JOIN LATERAL (
          WITH applicable AS (
            SELECT rules.day_of_week, rules.is_allowed
            FROM staff_availability_rules rules
            WHERE rules.staff_id = s.id
              AND rules.deleted_at IS NULL
              AND rules.rule_type = 'weekday_allowed'
              AND (rules.effective_start_date IS NULL OR rules.effective_start_date <= d.schedule_date::date)
              AND (rules.effective_end_date IS NULL OR rules.effective_end_date >= d.schedule_date::date)
          )
          SELECT
            CASE
              WHEN EXISTS(SELECT 1 FROM applicable)
                THEN
                  COALESCE((SELECT bool_or(a.is_allowed) FROM applicable a WHERE a.day_of_week = EXTRACT(DOW FROM d.schedule_date)::int), false)
                  AND NOT COALESCE((SELECT bool_or(NOT a.is_allowed) FROM applicable a WHERE a.day_of_week = EXTRACT(DOW FROM d.schedule_date)::int), false)
              ELSE true
            END AS is_allowed
        ) sar ON true
        ${includeInactive ? '' : 'WHERE s.active = true'}
        ORDER BY s.id ASC, d.schedule_date ASC
      `;

      let resultByDate;
      try {
        resultByDate = await queryWithRetry(
          () => pool.query(sqlByDate, [startDate, endDate]),
          { retries: 3, delayMs: 1000 }
        );
      } catch (queryError: any) {
        const missingOverrides =
          queryError?.code === '42P01' &&
          String(queryError?.message || '').includes('staff_schedule_overrides');
        const missingWeekPlans =
          queryError?.code === '42P01' &&
          String(queryError?.message || '').includes('staff_week_plans');
        const missingWeekly =
          queryError?.code === '42P01' &&
          String(queryError?.message || '').includes('staff_weekly_schedule');
        const missingAvailabilityRules = isMissingAvailabilityRulesTable(queryError);

        if (!(missingOverrides || missingWeekPlans || missingWeekly || missingAvailabilityRules)) throw queryError;

        const effectiveExpr = missingWeekly
          ? 'true'
          : `COALESCE(${
              [
                missingOverrides ? null : 'sso.is_scheduled',
                missingWeekPlans ? null : 'swp.is_scheduled',
                'sws.is_scheduled',
                'true',
              ].filter(Boolean).join(', ')
            })${missingAvailabilityRules ? '' : ' AND COALESCE(sar.is_allowed, true)'}`;

        const fallbackByDateSql = `
          SELECT
            s.id AS staff_id,
            d.schedule_date::date::text AS schedule_date,
            EXTRACT(DOW FROM d.schedule_date)::int AS day_of_week,
            ${effectiveExpr} AS is_scheduled
          FROM staff s
          CROSS JOIN generate_series($1::date, $2::date, '1 day'::interval) AS d(schedule_date)
          ${missingWeekly ? '' : `
          LEFT JOIN staff_weekly_schedule sws
            ON sws.staff_id = s.id
           AND sws.day_of_week = EXTRACT(DOW FROM d.schedule_date)::int
          `}
          ${missingWeekPlans || missingWeekly ? '' : `
          LEFT JOIN staff_week_plans swp
            ON swp.staff_id = s.id
           AND swp.week_start_date = DATE_TRUNC('week', d.schedule_date)::date
           AND swp.day_of_week = EXTRACT(DOW FROM d.schedule_date)::int
          `}
          ${missingOverrides ? '' : `
          LEFT JOIN staff_schedule_overrides sso
            ON sso.staff_id = s.id
           AND sso.schedule_date = d.schedule_date::date
          `}
          ${missingAvailabilityRules ? '' : `
          LEFT JOIN LATERAL (
            WITH applicable AS (
              SELECT rules.day_of_week, rules.is_allowed
              FROM staff_availability_rules rules
              WHERE rules.staff_id = s.id
                AND rules.deleted_at IS NULL
                AND rules.rule_type = 'weekday_allowed'
                AND (rules.effective_start_date IS NULL OR rules.effective_start_date <= d.schedule_date::date)
                AND (rules.effective_end_date IS NULL OR rules.effective_end_date >= d.schedule_date::date)
            )
            SELECT
              CASE
                WHEN EXISTS(SELECT 1 FROM applicable)
                  THEN
                    COALESCE((SELECT bool_or(a.is_allowed) FROM applicable a WHERE a.day_of_week = EXTRACT(DOW FROM d.schedule_date)::int), false)
                    AND NOT COALESCE((SELECT bool_or(NOT a.is_allowed) FROM applicable a WHERE a.day_of_week = EXTRACT(DOW FROM d.schedule_date)::int), false)
                ELSE true
              END AS is_allowed
          ) sar ON true
          `}
          ${includeInactive ? '' : 'WHERE s.active = true'}
          ORDER BY s.id ASC, d.schedule_date ASC
        `;

        resultByDate = await queryWithRetry(
          () => pool.query(fallbackByDateSql, [startDate, endDate]),
          { retries: 1, delayMs: 250 }
        );
      }

      const schedulesByDate: ScheduleRow[] = resultByDate.rows.map((row) => ({
        staff_id: Number(row.staff_id),
        day_of_week: Number(row.day_of_week),
        is_scheduled: Boolean(row.is_scheduled),
        schedule_date: String(row.schedule_date),
      }));

      return NextResponse.json({
        timezone: STAFF_SCHEDULE_TIMEZONE,
        today_day_of_week: getCurrentStaffDayOfWeek(),
        schedules: schedulesByDate,
      });
    }

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

    let result;
    try {
      result = await queryWithRetry(
        () => pool.query(sql),
        { retries: 3, delayMs: 1000 }
      );
    } catch (queryError) {
      if (!isMissingScheduleTable(queryError)) throw queryError;

      // Pre-migration fallback: treat all days as scheduled so UI still renders.
      const fallbackSql = `
        SELECT
          s.id AS staff_id,
          d.day_of_week::int AS day_of_week,
          true AS is_scheduled
        FROM staff s
        CROSS JOIN generate_series(0, 6) AS d(day_of_week)
        ${includeInactive ? '' : 'WHERE s.active = true'}
        ORDER BY s.id ASC, d.day_of_week ASC
      `;
      result = await queryWithRetry(
        () => pool.query(fallbackSql),
        { retries: 1, delayMs: 250 }
      );
    }

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
    const scheduleDate = body?.scheduleDate == null ? null : String(body.scheduleDate);
    const isScheduledRaw = body?.isScheduled;

    if (!Number.isFinite(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'Valid staffId is required' }, { status: 400 });
    }
    if (!isValidIsoDate(scheduleDate) && (!Number.isFinite(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
      return NextResponse.json({ error: 'dayOfWeek must be an integer between 0 and 6 when scheduleDate is not provided' }, { status: 400 });
    }
    if (typeof isScheduledRaw !== 'boolean') {
      return NextResponse.json({ error: 'isScheduled must be boolean' }, { status: 400 });
    }
    const isScheduled = isScheduledRaw;
    const resolvedScheduleDate = isValidIsoDate(scheduleDate)
      ? scheduleDate
      : null;

    if (isScheduled && resolvedScheduleDate) {
      try {
        const decision = await getStaffAvailabilityDecision(pool, staffId, resolvedScheduleDate, Number.isFinite(dayOfWeek) ? dayOfWeek : null);
        if (!decision.isAllowed) {
          return NextResponse.json({
            error: 'Not allowed by availability rule',
            details: `staffId=${staffId} is not allowed to work on ${resolvedScheduleDate}`,
            decision,
          }, { status: 400 });
        }
      } catch (validationError) {
        if (!isMissingAvailabilityRulesTable(validationError)) throw validationError;
      }
    }

    const sql = `
      INSERT INTO staff_weekly_schedule (staff_id, day_of_week, is_scheduled, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (staff_id, day_of_week)
      DO UPDATE SET
        is_scheduled = EXCLUDED.is_scheduled,
        updated_at = now()
      RETURNING staff_id, day_of_week, is_scheduled
    `;
    const sqlDateOverride = `
      INSERT INTO staff_schedule_overrides (staff_id, schedule_date, is_scheduled, updated_at)
      VALUES ($1, $2::date, $3, now())
      ON CONFLICT (staff_id, schedule_date)
      DO UPDATE SET
        is_scheduled = EXCLUDED.is_scheduled,
        updated_at = now()
      RETURNING staff_id, EXTRACT(DOW FROM schedule_date)::int AS day_of_week, schedule_date::text AS schedule_date, is_scheduled
    `;

    let result;
    try {
      result = await queryWithRetry(
        () => isValidIsoDate(scheduleDate)
          ? pool.query(sqlDateOverride, [staffId, scheduleDate, isScheduled])
          : pool.query(sql, [staffId, dayOfWeek, isScheduled]),
        { retries: 3, delayMs: 1000 }
      );
    } catch (queryError) {
      if (isMissingScheduleTable(queryError)) {
        return NextResponse.json({
          error: 'staff schedule table not found',
          details: 'Run migrations: 2026-03-20_create_staff_weekly_schedule.sql, 2026-03-31_create_staff_schedule_overrides.sql, and 2026-04-01_create_staff_availability_rules.sql',
        }, { status: 503 });
      }
      if (isForeignKeyViolation(queryError)) {
        return NextResponse.json({
          error: 'Staff not found',
          details: `No staff row exists for staffId=${staffId}`,
        }, { status: 404 });
      }
      throw queryError;
    }

    await invalidateCacheTags(['staff']);
    const payload = result.rows[0] ?? {
      staff_id: staffId,
      day_of_week: Number.isFinite(dayOfWeek) ? dayOfWeek : null,
      schedule_date: isValidIsoDate(scheduleDate) ? scheduleDate : null,
      is_scheduled: isScheduled,
    };
    publishStaffScheduleChanged({
      action: 'single',
      source: 'staff.schedule.put',
      changed: [{
        staff_id: Number(payload.staff_id),
        day_of_week: Number(payload.day_of_week),
        schedule_date: payload.schedule_date ?? null,
        is_scheduled: Boolean(payload.is_scheduled),
      }],
    }).catch(() => {});
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error updating staff schedule:', error);
    return NextResponse.json({
      error: 'Failed to update staff schedule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
