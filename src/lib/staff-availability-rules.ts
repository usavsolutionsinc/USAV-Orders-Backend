import type { Pool, PoolClient } from 'pg';

export type StaffRulesQueryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type StaffAvailabilityRuleType = 'weekday_allowed' | 'date_block' | 'date_allow';

export interface StaffAvailabilityDecision {
  hasRules: boolean;
  hasAllowed: boolean;
  hasDenied: boolean;
  isAllowed: boolean;
}

export function isMissingAvailabilityRulesTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === '42P01' && String(e?.message || '').includes('staff_availability_rules');
}

export async function getStaffAvailabilityDecision(
  queryable: StaffRulesQueryable,
  staffId: number,
  scheduleDate: string,
  dayOfWeek?: number | null
): Promise<StaffAvailabilityDecision> {
  const sql = `
    WITH applicable AS (
      SELECT sar.day_of_week, sar.is_allowed
      FROM staff_availability_rules sar
      WHERE sar.staff_id = $1
        AND sar.deleted_at IS NULL
        AND sar.rule_type = 'weekday_allowed'
        AND (sar.effective_start_date IS NULL OR sar.effective_start_date <= $2::date)
        AND (sar.effective_end_date IS NULL OR sar.effective_end_date >= $2::date)
    ),
    target AS (
      SELECT COALESCE($3::int, EXTRACT(DOW FROM $2::date)::int) AS day_of_week
    )
    SELECT
      EXISTS(SELECT 1 FROM applicable) AS has_rules,
      EXISTS(
        SELECT 1
        FROM applicable a
        JOIN target t ON t.day_of_week = a.day_of_week
        WHERE a.is_allowed = true
      ) AS has_allowed,
      EXISTS(
        SELECT 1
        FROM applicable a
        JOIN target t ON t.day_of_week = a.day_of_week
        WHERE a.is_allowed = false
      ) AS has_denied
  `;

  const result = await queryable.query(sql, [staffId, scheduleDate, dayOfWeek ?? null]);
  const row = result.rows[0] ?? {};
  const hasRules = Boolean(row.has_rules);
  const hasAllowed = Boolean(row.has_allowed);
  const hasDenied = Boolean(row.has_denied);
  const isAllowed = !hasRules || (hasAllowed && !hasDenied);

  return {
    hasRules,
    hasAllowed,
    hasDenied,
    isAllowed,
  };
}

