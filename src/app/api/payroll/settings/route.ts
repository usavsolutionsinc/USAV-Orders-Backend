/**
 * GET / PATCH /api/payroll/settings
 *
 * Singleton row (id=1) holding shop-wide payroll defaults — break window,
 * OT/DT thresholds and multipliers, timezone. Admin-only on both methods.
 *
 * Wired up so the admin payroll UI can drop in later without API work:
 *   • GET returns the current row.
 *   • PATCH accepts a partial body and updates only the fields that change.
 *
 * The defaults seeded in the migration are CA-standard (8 hr/day, 40 hr/wk
 * for 1.5×, 12 hr/day for 2×) with a 30-minute lunch from 12:30–1:00.
 */

import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

interface PayrollSettingsRow {
  id: number;
  default_break_minutes: number;
  default_lunch_start_minute: number;
  default_lunch_end_minute: number;
  overtime_daily_threshold_minutes: number;
  overtime_weekly_threshold_minutes: number;
  overtime_multiplier: string;
  double_time_daily_threshold_minutes: number;
  double_time_multiplier: string;
  timezone: string;
  updated_by: number | null;
  updated_at: string;
}

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  try {
    // payroll_settings is a shop-wide singleton (id=1) with no organization_id
    // column and no parent to scope by, so it can't carry an explicit org
    // predicate. Routing through tenantQuery sets the app.current_org GUC
    // (the RLS backstop) on the session for this read.
    const r = await tenantQuery<PayrollSettingsRow>(
      ctx.organizationId,
      `SELECT * FROM payroll_settings WHERE id = 1`,
    );
    return NextResponse.json({ settings: r.rows[0] ?? null }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('[/api/payroll/settings GET] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}, { permission: 'admin.manage_staff' });

const NUMERIC_FIELDS: Record<string, { col: string; min: number; max: number }> = {
  defaultBreakMinutes:               { col: 'default_break_minutes',               min: 0, max: 240 },
  defaultLunchStartMinute:           { col: 'default_lunch_start_minute',          min: 0, max: 1439 },
  defaultLunchEndMinute:             { col: 'default_lunch_end_minute',            min: 1, max: 1440 },
  overtimeDailyThresholdMinutes:     { col: 'overtime_daily_threshold_minutes',    min: 0, max: 1440 },
  overtimeWeeklyThresholdMinutes:    { col: 'overtime_weekly_threshold_minutes',   min: 0, max: 10080 },
  overtimeMultiplier:                { col: 'overtime_multiplier',                 min: 1.0, max: 5.0 },
  doubleTimeDailyThresholdMinutes:   { col: 'double_time_daily_threshold_minutes', min: 0, max: 1440 },
  doubleTimeMultiplier:              { col: 'double_time_multiplier',              min: 1.0, max: 5.0 },
};

export const PATCH = withAuth(async (req: NextRequest, me) => {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(body)) {
    const spec = NUMERIC_FIELDS[key];
    if (!spec) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
      return NextResponse.json({ error: 'OUT_OF_RANGE', field: key, min: spec.min, max: spec.max }, { status: 400 });
    }
    params.push(n);
    setClauses.push(`${spec.col} = $${params.length}`);
  }

  if (typeof body.timezone === 'string' && body.timezone.length > 0 && body.timezone.length < 64) {
    params.push(body.timezone);
    setClauses.push(`timezone = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'NO_FIELDS' }, { status: 400 });
  }

  params.push(me.staffId);
  setClauses.push(`updated_by = $${params.length}`);
  setClauses.push(`updated_at = NOW()`);

  try {
    // payroll_settings is a shop-wide singleton (id=1) with no organization_id
    // column and no parent to scope by, so the WHERE can't carry an explicit
    // org predicate. Running the write inside withTenantTransaction sets the
    // app.current_org GUC (the RLS backstop) for this UPDATE.
    const r = await withTenantTransaction(me.organizationId, (client) =>
      client.query<PayrollSettingsRow>(
        `UPDATE payroll_settings SET ${setClauses.join(', ')} WHERE id = 1 RETURNING *`,
        params,
      ),
    );
    return NextResponse.json({ settings: r.rows[0] });
  } catch (err) {
    console.error('[/api/payroll/settings PATCH] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}, { permission: 'admin.manage_staff' });
