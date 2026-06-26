import type { Pool } from 'pg';
import { TECH_EMPLOYEE_IDS } from '@/utils/staff';

/**
 * Resolves `staff.id` from station `techId` (numeric staff id or legacy employee_id mapping).
 */
export async function resolveStaffIdFromTechParam(
  db: Pick<Pool, 'query'>,
  techId: string | number,
): Promise<number | null> {
  // Strict all-digits check. `parseInt('5-PACK')` returns 5, so the old
  // !Number.isNaN guard let a malformed station token like "5-PACK" resolve to
  // staff id 5 and mis-attribute the verdict. Only treat the param as a numeric
  // staff id when it is purely digits; otherwise fall through to the
  // employee_id mapping below.
  const raw = String(techId).trim();
  if (/^\d+$/.test(raw)) {
    const techIdNum = Number(raw);
    if (techIdNum > 0) {
      const byId = await db.query('SELECT id FROM staff WHERE id = $1 LIMIT 1', [techIdNum]);
      if (byId.rows.length > 0) return Number(byId.rows[0].id);
    }
  }

  const employeeId = TECH_EMPLOYEE_IDS[String(techId)] || String(techId);
  const byEmployeeId = await db.query('SELECT id FROM staff WHERE employee_id = $1 LIMIT 1', [
    employeeId,
  ]);
  if (byEmployeeId.rows.length > 0) return Number(byEmployeeId.rows[0].id);
  return null;
}
