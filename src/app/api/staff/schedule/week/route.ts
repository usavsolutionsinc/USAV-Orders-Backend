import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import { isMondayDateKey } from '@/lib/staff-availability';
import { publishStaffScheduleChanged } from '@/lib/realtime/publish';
import { getStaffAvailabilityDecision, isMissingAvailabilityRulesTable } from '@/lib/staff-availability-rules';

function isDatabaseUnavailable(error: unknown) {
  return isTransientDbError(error);
}

function isMissingScheduleTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === '42P01' && (
    String(e?.message || '').includes('staff_weekly_schedule') ||
    String(e?.message || '').includes('staff_schedule_overrides') ||
    String(e?.message || '').includes('staff_week_plans') ||
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
    const weekStartDate = searchParams.get('weekStart');
    const includeInactive = searchParams.get('includeInactive') === 'true';

    if (!isValidIsoDate(weekStartDate) || !isMondayDateKey(weekStartDate)) {
      return NextResponse.json({ error: 'weekStart must be a Monday in YYYY-MM-DD format' }, { status: 400 });
    }

    const sql = `
      SELECT
        s.id AS staff_id,
        s.name,
        s.role,
        s.active,
        d.day_of_week::int AS day_of_week,
        ($1::date + (d.day_of_week || ' day')::interval)::date::text AS schedule_date,
        sws.is_scheduled AS template_is_scheduled,
        swp.is_scheduled AS plan_is_scheduled,
        sso.is_scheduled AS override_is_scheduled,
        COALESCE(sar.is_allowed, true) AS allowed_by_rule,
        (
          COALESCE(sso.is_scheduled, swp.is_scheduled, sws.is_scheduled, true)
          AND COALESCE(sar.is_allowed, true)
        ) AS effective_is_scheduled
      FROM staff s
      CROSS JOIN generate_series(0, 6) AS d(day_of_week)
      LEFT JOIN staff_weekly_schedule sws
        ON sws.staff_id = s.id
       AND sws.day_of_week = d.day_of_week
      LEFT JOIN staff_week_plans swp
        ON swp.staff_id = s.id
       AND swp.week_start_date = $1::date
       AND swp.day_of_week = d.day_of_week
      LEFT JOIN staff_schedule_overrides sso
        ON sso.staff_id = s.id
       AND sso.schedule_date = ($1::date + (d.day_of_week || ' day')::interval)::date
      LEFT JOIN LATERAL (
        WITH applicable AS (
          SELECT rules.day_of_week, rules.is_allowed
          FROM staff_availability_rules rules
          WHERE rules.staff_id = s.id
            AND rules.deleted_at IS NULL
            AND rules.rule_type = 'weekday_allowed'
            AND (rules.effective_start_date IS NULL OR rules.effective_start_date <= ($1::date + (d.day_of_week || ' day')::interval)::date)
            AND (rules.effective_end_date IS NULL OR rules.effective_end_date >= ($1::date + (d.day_of_week || ' day')::interval)::date)
        )
        SELECT
          CASE
            WHEN EXISTS(SELECT 1 FROM applicable)
              THEN
                COALESCE((SELECT bool_or(a.is_allowed) FROM applicable a WHERE a.day_of_week = d.day_of_week::int), false)
                AND NOT COALESCE((SELECT bool_or(NOT a.is_allowed) FROM applicable a WHERE a.day_of_week = d.day_of_week::int), false)
            ELSE true
          END AS is_allowed
      ) sar ON true
      ${includeInactive ? '' : 'WHERE s.active = true'}
      ORDER BY s.role ASC, s.name ASC, d.day_of_week ASC
    `;

    const result = await queryWithRetry(
      () => pool.query(sql, [weekStartDate]),
      { retries: 3, delayMs: 1000 }
    );

    return NextResponse.json({
      weekStartDate,
      rows: result.rows.map((row) => ({
        staffId: Number(row.staff_id),
        name: String(row.name || ''),
        role: String(row.role || ''),
        active: Boolean(row.active),
        dayOfWeek: Number(row.day_of_week),
        scheduleDate: String(row.schedule_date || ''),
        templateIsScheduled: row.template_is_scheduled == null ? null : Boolean(row.template_is_scheduled),
        planIsScheduled: row.plan_is_scheduled == null ? null : Boolean(row.plan_is_scheduled),
        overrideIsScheduled: row.override_is_scheduled == null ? null : Boolean(row.override_is_scheduled),
        allowedByRule: Boolean(row.allowed_by_rule),
        effectiveIsScheduled: Boolean(row.effective_is_scheduled),
      })),
    });
  } catch (error) {
    if (isMissingScheduleTable(error)) {
      return NextResponse.json({
        error: 'staff schedule table not found',
        details: 'Run migrations: 2026-03-20_create_staff_weekly_schedule.sql, 2026-03-31_create_staff_schedule_overrides.sql, 2026-04-01_create_staff_week_plans.sql, and 2026-04-01_create_staff_availability_rules.sql',
      }, { status: 503 });
    }
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json({ weekStartDate: null, rows: [] }, { headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error fetching week schedule:', error);
    return NextResponse.json({
      error: 'Failed to fetch week schedule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const staffId = Number(body?.staffId);
    const weekStartDate = body?.weekStartDate == null ? null : String(body.weekStartDate);
    const dayOfWeek = Number(body?.dayOfWeek);
    const isScheduled = Boolean(body?.isScheduled);
    const source = String(body?.source || 'manual');
    const createdByStaffIdRaw = body?.createdByStaffId;
    const createdByStaffId = createdByStaffIdRaw == null ? null : Number(createdByStaffIdRaw);

    if (!Number.isFinite(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'Valid staffId is required' }, { status: 400 });
    }
    if (!isValidIsoDate(weekStartDate) || !isMondayDateKey(weekStartDate)) {
      return NextResponse.json({ error: 'weekStartDate must be a Monday in YYYY-MM-DD format' }, { status: 400 });
    }
    if (!Number.isFinite(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return NextResponse.json({ error: 'dayOfWeek must be an integer between 0 and 6' }, { status: 400 });
    }
    if (createdByStaffId != null && (!Number.isFinite(createdByStaffId) || createdByStaffId <= 0)) {
      return NextResponse.json({ error: 'createdByStaffId must be null or a positive number' }, { status: 400 });
    }

    let scheduleDate = '';
    if (isScheduled) {
      const dateResult = await queryWithRetry(
        () => pool.query(
          `SELECT ($1::date + ($2 || ' day')::interval)::date::text AS schedule_date`,
          [weekStartDate, dayOfWeek]
        ),
        { retries: 2, delayMs: 200 }
      );
      scheduleDate = String(dateResult.rows[0]?.schedule_date || '');
      if (scheduleDate) {
        try {
          const decision = await getStaffAvailabilityDecision(pool, staffId, scheduleDate, dayOfWeek);
          if (!decision.isAllowed) {
            return NextResponse.json({
              error: 'Not allowed by availability rule',
              details: `staffId=${staffId} is not allowed to work on ${scheduleDate}`,
              decision,
            }, { status: 400 });
          }
        } catch (validationError) {
          if (!isMissingAvailabilityRulesTable(validationError)) throw validationError;
        }
      }
    }

    const sql = `
      INSERT INTO staff_week_plans (
        staff_id, week_start_date, day_of_week, is_scheduled, source, created_by_staff_id, updated_at
      )
      VALUES ($1, $2::date, $3, $4, $5, $6, now())
      ON CONFLICT (staff_id, week_start_date, day_of_week)
      DO UPDATE SET
        is_scheduled = EXCLUDED.is_scheduled,
        source = EXCLUDED.source,
        created_by_staff_id = EXCLUDED.created_by_staff_id,
        updated_at = now()
      RETURNING
        staff_id,
        day_of_week,
        (week_start_date + (day_of_week || ' day')::interval)::date::text AS schedule_date,
        is_scheduled
    `;

    let result;
    try {
      result = await queryWithRetry(
        () => pool.query(sql, [staffId, weekStartDate, dayOfWeek, isScheduled, source, createdByStaffId]),
        { retries: 3, delayMs: 1000 }
      );
    } catch (queryError) {
      if (isMissingScheduleTable(queryError)) {
        return NextResponse.json({
          error: 'staff_week_plans table not found',
          details: 'Run migrations: 2026-04-01_create_staff_week_plans.sql and 2026-04-01_create_staff_availability_rules.sql',
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

    const row = result.rows[0];
    await invalidateCacheTags(['staff']);
    publishStaffScheduleChanged({
      action: 'single',
      source: 'staff.schedule.week.put',
      changed: [{
        staff_id: Number(row?.staff_id ?? staffId),
        day_of_week: Number(row?.day_of_week ?? dayOfWeek),
        schedule_date: String(row?.schedule_date || ''),
        is_scheduled: Boolean(row?.is_scheduled ?? isScheduled),
      }],
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      row: {
        staffId: Number(row?.staff_id ?? staffId),
        dayOfWeek: Number(row?.day_of_week ?? dayOfWeek),
        scheduleDate: String(row?.schedule_date || ''),
        isScheduled: Boolean(row?.is_scheduled ?? isScheduled),
      },
    });
  } catch (error) {
    console.error('Error updating week schedule:', error);
    return NextResponse.json({
      error: 'Failed to update week schedule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
