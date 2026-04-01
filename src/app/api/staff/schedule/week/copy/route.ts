import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import { isMondayDateKey } from '@/lib/staff-availability';
import { publishStaffScheduleChanged } from '@/lib/realtime/publish';

type CopyMode = 'template' | 'from_week';

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

function isValidIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fromWeekStartDate = body?.fromWeekStartDate == null ? null : String(body.fromWeekStartDate);
    const toWeekStartDate = body?.toWeekStartDate == null ? null : String(body.toWeekStartDate);
    const mode: CopyMode = body?.mode === 'template' ? 'template' : 'from_week';
    const includeInactive = body?.includeInactive === true;
    const createdByStaffIdRaw = body?.createdByStaffId;
    const createdByStaffId = createdByStaffIdRaw == null ? null : Number(createdByStaffIdRaw);

    if (!isValidIsoDate(fromWeekStartDate) || !isMondayDateKey(fromWeekStartDate)) {
      return NextResponse.json({ error: 'fromWeekStartDate must be a Monday in YYYY-MM-DD format' }, { status: 400 });
    }
    if (!isValidIsoDate(toWeekStartDate) || !isMondayDateKey(toWeekStartDate)) {
      return NextResponse.json({ error: 'toWeekStartDate must be a Monday in YYYY-MM-DD format' }, { status: 400 });
    }
    if (fromWeekStartDate === toWeekStartDate) {
      return NextResponse.json({ error: 'fromWeekStartDate and toWeekStartDate must be different' }, { status: 400 });
    }
    if (createdByStaffId != null && (!Number.isFinite(createdByStaffId) || createdByStaffId <= 0)) {
      return NextResponse.json({ error: 'createdByStaffId must be null or a positive number' }, { status: 400 });
    }

    const sourceLabel = mode === 'template' ? 'copied_from_template' : 'copied_from_week';
    const sql = mode === 'template'
      ? `
        WITH src AS (
          SELECT
            s.id AS staff_id,
            d.day_of_week::int AS day_of_week,
            (
              COALESCE(sws.is_scheduled, true)
              AND COALESCE(sar.is_allowed, true)
            ) AS is_scheduled
          FROM staff s
          CROSS JOIN generate_series(0, 6) AS d(day_of_week)
          LEFT JOIN staff_weekly_schedule sws
            ON sws.staff_id = s.id
           AND sws.day_of_week = d.day_of_week
          LEFT JOIN LATERAL (
            WITH applicable AS (
              SELECT rules.day_of_week, rules.is_allowed
              FROM staff_availability_rules rules
              WHERE rules.staff_id = s.id
                AND rules.deleted_at IS NULL
                AND rules.rule_type = 'weekday_allowed'
                AND (rules.effective_start_date IS NULL OR rules.effective_start_date <= ($2::date + (d.day_of_week || ' day')::interval)::date)
                AND (rules.effective_end_date IS NULL OR rules.effective_end_date >= ($2::date + (d.day_of_week || ' day')::interval)::date)
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
        )
        INSERT INTO staff_week_plans (
          staff_id, week_start_date, day_of_week, is_scheduled, source, created_by_staff_id, updated_at
        )
        SELECT staff_id, $2::date, day_of_week, is_scheduled, $3, $4, now()
        FROM src
        ON CONFLICT (staff_id, week_start_date, day_of_week)
        DO UPDATE SET
          is_scheduled = EXCLUDED.is_scheduled,
          source = EXCLUDED.source,
          created_by_staff_id = EXCLUDED.created_by_staff_id,
          updated_at = now()
        RETURNING staff_id, day_of_week, (week_start_date + (day_of_week || ' day')::interval)::date::text AS schedule_date, is_scheduled
      `
      : `
        WITH src AS (
          SELECT
            s.id AS staff_id,
            d.day_of_week::int AS day_of_week,
            (
              COALESCE(sso.is_scheduled, swp.is_scheduled, sws.is_scheduled, true)
              AND COALESCE(sar.is_allowed, true)
            ) AS is_scheduled
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
                AND (rules.effective_start_date IS NULL OR rules.effective_start_date <= ($2::date + (d.day_of_week || ' day')::interval)::date)
                AND (rules.effective_end_date IS NULL OR rules.effective_end_date >= ($2::date + (d.day_of_week || ' day')::interval)::date)
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
        )
        INSERT INTO staff_week_plans (
          staff_id, week_start_date, day_of_week, is_scheduled, source, created_by_staff_id, updated_at
        )
        SELECT staff_id, $2::date, day_of_week, is_scheduled, $3, $4, now()
        FROM src
        ON CONFLICT (staff_id, week_start_date, day_of_week)
        DO UPDATE SET
          is_scheduled = EXCLUDED.is_scheduled,
          source = EXCLUDED.source,
          created_by_staff_id = EXCLUDED.created_by_staff_id,
          updated_at = now()
        RETURNING staff_id, day_of_week, (week_start_date + (day_of_week || ' day')::interval)::date::text AS schedule_date, is_scheduled
      `;

    const result = await queryWithRetry(
      () => pool.query(sql, [fromWeekStartDate, toWeekStartDate, sourceLabel, createdByStaffId]),
      { retries: 3, delayMs: 1000 }
    );

    const changed = result.rows.map((row) => ({
      staff_id: Number(row.staff_id),
      day_of_week: Number(row.day_of_week),
      schedule_date: String(row.schedule_date || ''),
      is_scheduled: Boolean(row.is_scheduled),
    }));

    await invalidateCacheTags(['staff']);
    publishStaffScheduleChanged({
      action: 'bulk',
      source: 'staff.schedule.week.copy',
      changed,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      copiedCount: changed.length,
      fromWeekStartDate,
      toWeekStartDate,
      mode,
    });
  } catch (error) {
    if (isMissingScheduleTable(error)) {
      return NextResponse.json({
        error: 'staff schedule table not found',
        details: 'Run migrations: 2026-03-20_create_staff_weekly_schedule.sql, 2026-03-31_create_staff_schedule_overrides.sql, 2026-04-01_create_staff_week_plans.sql, and 2026-04-01_create_staff_availability_rules.sql',
      }, { status: 503 });
    }
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503, headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error copying week schedule:', error);
    return NextResponse.json({
      error: 'Failed to copy week schedule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
