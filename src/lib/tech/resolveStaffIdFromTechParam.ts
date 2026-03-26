import type { Pool } from 'pg';

/**
 * Resolves `staff.id` from station `techId` (numeric staff id or legacy employee_id mapping).
 */
export async function resolveStaffIdFromTechParam(
  db: Pick<Pool, 'query'>,
  techId: string | number,
): Promise<number | null> {
  const techIdNum = parseInt(String(techId), 10);
  if (!Number.isNaN(techIdNum) && techIdNum > 0) {
    const byId = await db.query('SELECT id FROM staff WHERE id = $1 LIMIT 1', [techIdNum]);
    if (byId.rows.length > 0) return Number(byId.rows[0].id);
  }

  const techEmployeeIds: Record<string, string> = {
    '1': 'TECH001',
    '2': 'TECH002',
    '3': 'TECH003',
    '4': 'TECH004',
  };
  const employeeId = techEmployeeIds[String(techId)] || String(techId);
  const byEmployeeId = await db.query('SELECT id FROM staff WHERE employee_id = $1 LIMIT 1', [
    employeeId,
  ]);
  if (byEmployeeId.rows.length > 0) return Number(byEmployeeId.rows[0].id);
  return null;
}
