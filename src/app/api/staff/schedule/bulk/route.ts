import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import { publishStaffScheduleChanged } from '@/lib/realtime/publish';
import { getStaffAvailabilityDecision, isMissingAvailabilityRulesTable } from '@/lib/staff-availability-rules';

interface BulkUpdateItem {
  staffId: number;
  dayOfWeek?: number;
  scheduleDate?: string;
  isScheduled: boolean;
}

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

function toNumber(value: unknown): number {
  return Number(value);
}

function isValidIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const updatesRaw = Array.isArray(body?.updates) ? body.updates : [];

    const updates: BulkUpdateItem[] = updatesRaw
      .map((row: any) => ({
        staffId: toNumber(row?.staffId),
        dayOfWeek: Number.isFinite(toNumber(row?.dayOfWeek)) ? toNumber(row?.dayOfWeek) : undefined,
        scheduleDate: typeof row?.scheduleDate === 'string' ? row.scheduleDate : undefined,
        isScheduled: Boolean(row?.isScheduled),
      }))
      .filter((row: BulkUpdateItem) =>
        Number.isFinite(row.staffId) &&
        row.staffId > 0 &&
        (
          (row.dayOfWeek != null && row.dayOfWeek >= 0 && row.dayOfWeek <= 6) ||
          isValidIsoDate(row.scheduleDate)
        )
      );

    if (updates.length === 0) {
      return NextResponse.json({ error: 'updates[] is required' }, { status: 400 });
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

    const client = await pool.connect();
    const changed: Array<{ staff_id: number; day_of_week: number; schedule_date?: string | null; is_scheduled: boolean }> = [];

    try {
      await client.query('BEGIN');
      for (const row of updates) {
        if (row.isScheduled && isValidIsoDate(row.scheduleDate)) {
          try {
            const decision = await getStaffAvailabilityDecision(
              client,
              row.staffId,
              row.scheduleDate,
              row.dayOfWeek ?? null
            );
            if (!decision.isAllowed) {
              await client.query('ROLLBACK');
              return NextResponse.json({
                error: 'Not allowed by availability rule',
                details: `staffId=${row.staffId} is not allowed to work on ${row.scheduleDate}`,
                row,
                decision,
              }, { status: 400 });
            }
          } catch (validationError) {
            if (!isMissingAvailabilityRulesTable(validationError)) throw validationError;
          }
        }

        const result = await queryWithRetry(
          () => isValidIsoDate(row.scheduleDate)
            ? client.query(sqlDateOverride, [row.staffId, row.scheduleDate, row.isScheduled])
            : client.query(sql, [row.staffId, row.dayOfWeek, row.isScheduled]),
          { retries: 2, delayMs: 200 }
        );
        const updated = result.rows[0];
        if (updated) {
          changed.push({
            staff_id: Number(updated.staff_id),
            day_of_week: Number(updated.day_of_week),
            schedule_date: updated.schedule_date == null ? null : String(updated.schedule_date),
            is_scheduled: Boolean(updated.is_scheduled),
          });
        }
      }
      await client.query('COMMIT');
    } catch (queryError) {
      await client.query('ROLLBACK');
      if (isMissingScheduleTable(queryError)) {
        return NextResponse.json({
          error: 'staff schedule table not found',
          details: 'Run migrations: 2026-03-20_create_staff_weekly_schedule.sql, 2026-03-31_create_staff_schedule_overrides.sql, 2026-04-01_create_staff_week_plans.sql, and 2026-04-01_create_staff_availability_rules.sql',
        }, { status: 503 });
      }
      if (isForeignKeyViolation(queryError)) {
        return NextResponse.json({
          error: 'Invalid staffId in updates[]',
          details: 'At least one update references a missing staff row',
        }, { status: 404 });
      }
      throw queryError;
    } finally {
      client.release();
    }

    await invalidateCacheTags(['staff']);
    publishStaffScheduleChanged({
      action: 'bulk',
      source: 'staff.schedule.bulk',
      changed,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      changedCount: changed.length,
      changed,
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json({
        error: 'Database unavailable',
      }, { status: 503, headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error bulk updating staff schedule:', error);
    return NextResponse.json({
      error: 'Failed to update staff schedule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
