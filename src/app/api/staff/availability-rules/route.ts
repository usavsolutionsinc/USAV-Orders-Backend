import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import type { StaffAvailabilityRuleType } from '@/lib/staff-availability-rules';

const RULE_TYPES: StaffAvailabilityRuleType[] = ['weekday_allowed', 'date_block', 'date_allow'];

function isDatabaseUnavailable(error: unknown) {
  return isTransientDbError(error);
}

function isMissingRulesTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === '42P01' && String(e?.message || '').includes('staff_availability_rules');
}

function isForeignKeyViolation(error: unknown): boolean {
  const e = error as { code?: string } | null;
  return e?.code === '23503';
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string } | null;
  return e?.code === '23505';
}

function isValidIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseNullableDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const asString = String(value);
  return isValidIsoDate(asString) ? asString : null;
}

function toRuleType(value: unknown): StaffAvailabilityRuleType | null {
  const v = String(value || '').trim() as StaffAvailabilityRuleType;
  return RULE_TYPES.includes(v) ? v : null;
}

function isValidDayOfWeek(dayOfWeek: unknown): dayOfWeek is number {
  return Number.isInteger(dayOfWeek) && Number(dayOfWeek) >= 0 && Number(dayOfWeek) <= 6;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const staffId = Number(searchParams.get('staffId'));
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    const where: string[] = [];
    const params: Array<number | string> = [];

    if (Number.isFinite(staffId) && staffId > 0) {
      params.push(staffId);
      where.push(`staff_id = $${params.length}`);
    }
    if (!includeDeleted) {
      where.push('deleted_at IS NULL');
    }

    const sql = `
      SELECT
        id,
        staff_id,
        rule_type,
        day_of_week,
        is_allowed,
        effective_start_date::text AS effective_start_date,
        effective_end_date::text AS effective_end_date,
        priority,
        reason,
        created_by_staff_id,
        created_at,
        updated_at,
        deleted_at
      FROM staff_availability_rules
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY staff_id ASC, priority ASC, day_of_week ASC NULLS LAST, id ASC
    `;

    const result = await queryWithRetry(
      () => pool.query(sql, params),
      { retries: 3, delayMs: 1000 }
    );

    return NextResponse.json({
      rules: result.rows.map((row) => ({
        id: Number(row.id),
        staffId: Number(row.staff_id),
        ruleType: String(row.rule_type),
        dayOfWeek: row.day_of_week == null ? null : Number(row.day_of_week),
        isAllowed: Boolean(row.is_allowed),
        effectiveStartDate: row.effective_start_date ? String(row.effective_start_date) : null,
        effectiveEndDate: row.effective_end_date ? String(row.effective_end_date) : null,
        priority: Number(row.priority),
        reason: row.reason == null ? null : String(row.reason),
        createdByStaffId: row.created_by_staff_id == null ? null : Number(row.created_by_staff_id),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
      })),
    });
  } catch (error) {
    if (isMissingRulesTable(error)) {
      return NextResponse.json({
        error: 'staff_availability_rules table not found',
        details: 'Run migration: 2026-04-01_create_staff_availability_rules.sql',
      }, { status: 503 });
    }
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json({ rules: [] }, { headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error fetching staff availability rules:', error);
    return NextResponse.json({
      error: 'Failed to fetch staff availability rules',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const staffId = Number(body?.staffId);
    const ruleType = toRuleType(body?.ruleType);
    const dayOfWeekRaw = body?.dayOfWeek == null ? null : Number(body.dayOfWeek);
    const dayOfWeek = dayOfWeekRaw == null ? null : dayOfWeekRaw;
    const isAllowed = body?.isAllowed == null ? true : Boolean(body.isAllowed);
    const effectiveStartDate = parseNullableDate(body?.effectiveStartDate);
    const effectiveEndDate = parseNullableDate(body?.effectiveEndDate);
    const priorityRaw = body?.priority == null ? 100 : Number(body.priority);
    const priority = Number.isInteger(priorityRaw) ? priorityRaw : 100;
    const reason = body?.reason == null ? null : String(body.reason).trim() || null;
    const createdByStaffIdRaw = body?.createdByStaffId;
    const createdByStaffId = createdByStaffIdRaw == null ? null : Number(createdByStaffIdRaw);

    if (!Number.isFinite(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'Valid staffId is required' }, { status: 400 });
    }
    if (!ruleType) {
      return NextResponse.json({ error: 'ruleType must be weekday_allowed, date_block, or date_allow' }, { status: 400 });
    }
    if (ruleType === 'weekday_allowed' && !isValidDayOfWeek(dayOfWeek)) {
      return NextResponse.json({ error: 'dayOfWeek must be an integer between 0 and 6 for weekday_allowed' }, { status: 400 });
    }
    if (ruleType !== 'weekday_allowed' && dayOfWeek != null && !isValidDayOfWeek(dayOfWeek)) {
      return NextResponse.json({ error: 'dayOfWeek must be null or an integer between 0 and 6' }, { status: 400 });
    }
    if (body?.effectiveStartDate != null && !effectiveStartDate) {
      return NextResponse.json({ error: 'effectiveStartDate must be YYYY-MM-DD' }, { status: 400 });
    }
    if (body?.effectiveEndDate != null && !effectiveEndDate) {
      return NextResponse.json({ error: 'effectiveEndDate must be YYYY-MM-DD' }, { status: 400 });
    }
    if (effectiveStartDate && effectiveEndDate && effectiveEndDate < effectiveStartDate) {
      return NextResponse.json({ error: 'effectiveEndDate must be on or after effectiveStartDate' }, { status: 400 });
    }
    if (createdByStaffId != null && (!Number.isFinite(createdByStaffId) || createdByStaffId <= 0)) {
      return NextResponse.json({ error: 'createdByStaffId must be null or a positive number' }, { status: 400 });
    }

    const sql = `
      INSERT INTO staff_availability_rules (
        staff_id,
        rule_type,
        day_of_week,
        is_allowed,
        effective_start_date,
        effective_end_date,
        priority,
        reason,
        created_by_staff_id,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, now())
      RETURNING
        id,
        staff_id,
        rule_type,
        day_of_week,
        is_allowed,
        effective_start_date::text AS effective_start_date,
        effective_end_date::text AS effective_end_date,
        priority,
        reason,
        created_by_staff_id,
        created_at,
        updated_at,
        deleted_at
    `;

    const result = await queryWithRetry(
      () => pool.query(sql, [
        staffId,
        ruleType,
        dayOfWeek,
        isAllowed,
        effectiveStartDate,
        effectiveEndDate,
        priority,
        reason,
        createdByStaffId,
      ]),
      { retries: 3, delayMs: 1000 }
    );

    await invalidateCacheTags(['staff']);
    return NextResponse.json({ success: true, rule: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (isMissingRulesTable(error)) {
      return NextResponse.json({
        error: 'staff_availability_rules table not found',
        details: 'Run migration: 2026-04-01_create_staff_availability_rules.sql',
      }, { status: 503 });
    }
    if (isForeignKeyViolation(error)) {
      return NextResponse.json({
        error: 'Invalid staff id reference',
        details: 'staffId or createdByStaffId does not exist',
      }, { status: 404 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json({
        error: 'Duplicate rule',
        details: 'An active rule with the same staff/day/date window already exists',
      }, { status: 409 });
    }
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503, headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error creating staff availability rule:', error);
    return NextResponse.json({
      error: 'Failed to create staff availability rule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const id = Number(body?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Valid id is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const params: Array<number | string | boolean | null> = [];

    if (body?.ruleType !== undefined) {
      const ruleType = toRuleType(body.ruleType);
      if (!ruleType) return NextResponse.json({ error: 'Invalid ruleType' }, { status: 400 });
      params.push(ruleType);
      updates.push(`rule_type = $${params.length}`);
    }
    if (body?.dayOfWeek !== undefined) {
      const day = body.dayOfWeek == null ? null : Number(body.dayOfWeek);
      if (day != null && !isValidDayOfWeek(day)) {
        return NextResponse.json({ error: 'dayOfWeek must be null or 0-6' }, { status: 400 });
      }
      params.push(day);
      updates.push(`day_of_week = $${params.length}`);
    }
    if (body?.isAllowed !== undefined) {
      params.push(Boolean(body.isAllowed));
      updates.push(`is_allowed = $${params.length}`);
    }
    if (body?.effectiveStartDate !== undefined) {
      const v = parseNullableDate(body.effectiveStartDate);
      if (body.effectiveStartDate != null && !v) return NextResponse.json({ error: 'effectiveStartDate must be YYYY-MM-DD' }, { status: 400 });
      params.push(v);
      updates.push(`effective_start_date = $${params.length}::date`);
    }
    if (body?.effectiveEndDate !== undefined) {
      const v = parseNullableDate(body.effectiveEndDate);
      if (body.effectiveEndDate != null && !v) return NextResponse.json({ error: 'effectiveEndDate must be YYYY-MM-DD' }, { status: 400 });
      params.push(v);
      updates.push(`effective_end_date = $${params.length}::date`);
    }
    if (body?.priority !== undefined) {
      const priority = Number(body.priority);
      if (!Number.isInteger(priority)) return NextResponse.json({ error: 'priority must be integer' }, { status: 400 });
      params.push(priority);
      updates.push(`priority = $${params.length}`);
    }
    if (body?.reason !== undefined) {
      const reason = body.reason == null ? null : String(body.reason).trim() || null;
      params.push(reason);
      updates.push(`reason = $${params.length}`);
    }
    if (body?.deletedAt !== undefined) {
      const deletedAt = body.deletedAt == null ? null : String(body.deletedAt);
      params.push(deletedAt);
      updates.push(`deleted_at = $${params.length}::timestamptz`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    params.push(id);
    const sql = `
      UPDATE staff_availability_rules
      SET
        ${updates.join(', ')},
        updated_at = now()
      WHERE id = $${params.length}
      RETURNING
        id,
        staff_id,
        rule_type,
        day_of_week,
        is_allowed,
        effective_start_date::text AS effective_start_date,
        effective_end_date::text AS effective_end_date,
        priority,
        reason,
        created_by_staff_id,
        created_at,
        updated_at,
        deleted_at
    `;

    const result = await queryWithRetry(
      () => pool.query(sql, params),
      { retries: 3, delayMs: 1000 }
    );
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    await invalidateCacheTags(['staff']);
    return NextResponse.json({ success: true, rule: row });
  } catch (error) {
    if (isMissingRulesTable(error)) {
      return NextResponse.json({
        error: 'staff_availability_rules table not found',
        details: 'Run migration: 2026-04-01_create_staff_availability_rules.sql',
      }, { status: 503 });
    }
    if (isForeignKeyViolation(error)) {
      return NextResponse.json({
        error: 'Invalid staff id reference',
        details: 'createdByStaffId does not exist',
      }, { status: 404 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json({
        error: 'Duplicate rule',
        details: 'An active rule with the same staff/day/date window already exists',
      }, { status: 409 });
    }
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503, headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error updating staff availability rule:', error);
    return NextResponse.json({
      error: 'Failed to update staff availability rule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Valid id is required' }, { status: 400 });
    }

    const result = await queryWithRetry(
      () => pool.query(
        `
          UPDATE staff_availability_rules
          SET deleted_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING id
        `,
        [id]
      ),
      { retries: 3, delayMs: 1000 }
    );

    if (!result.rows[0]) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    await invalidateCacheTags(['staff']);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (isMissingRulesTable(error)) {
      return NextResponse.json({
        error: 'staff_availability_rules table not found',
        details: 'Run migration: 2026-04-01_create_staff_availability_rules.sql',
      }, { status: 503 });
    }
    if (isDatabaseUnavailable(error)) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503, headers: { 'x-db-fallback': 'unavailable' } });
    }
    console.error('Error deleting staff availability rule:', error);
    return NextResponse.json({
      error: 'Failed to delete staff availability rule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

