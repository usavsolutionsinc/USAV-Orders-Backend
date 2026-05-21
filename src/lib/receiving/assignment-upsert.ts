/**
 * Deterministic work_assignment upsert for RECEIVING entities.
 *
 * Whenever needs_test or assigned_tech_id changes on a receiving row or
 * receiving_lines row, call this function to keep work_assignments in sync.
 *
 * Rules:
 *   - needsTest=true  + techId present  → upsert ASSIGNED assignment
 *   - needsTest=false OR techId null    → cancel any active assignment
 */

import { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export interface UpsertReceivingAssignmentParams {
  db: DbClient;
  /** Phase 3b: tenant scope for the INSERT branch. */
  organizationId: string;
  receivingId: number;
  needsTest: boolean;
  assignedTechId: number | null;
  notes?: string;
}

export async function upsertReceivingAssignment({
  db,
  organizationId,
  receivingId,
  needsTest,
  assignedTechId,
  notes,
}: UpsertReceivingAssignmentParams): Promise<{ action: 'upserted' | 'canceled' | 'noop' }> {
  if (!Number.isFinite(receivingId) || receivingId <= 0) return { action: 'noop' };

  const existingRes = await db.query<{ id: number; status: string }>(
    `SELECT id, status
     FROM work_assignments
     WHERE entity_type = 'RECEIVING'
       AND entity_id   = $1
       AND work_type   = 'TEST'
       AND status IN ('ASSIGNED', 'IN_PROGRESS')
     ORDER BY id DESC
     LIMIT 1`,
    [receivingId]
  );
  const existing = existingRes.rows[0] ?? null;

  if (!needsTest || !assignedTechId) {
    // Cancel any open assignment
    if (existing) {
      await db.query(
        `UPDATE work_assignments
         SET status = 'CANCELED', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [existing.id]
      );
      return { action: 'canceled' };
    }
    return { action: 'noop' };
  }

  // needs_test=true + techId present
  if (existing) {
    await db.query(
      `UPDATE work_assignments
       SET assigned_tech_id = $1,
           notes            = COALESCE($2, notes),
           updated_at       = NOW()
       WHERE id = $3`,
      [assignedTechId, notes ?? null, existing.id]
    );
  } else {
    await db.query(
      `INSERT INTO work_assignments
         (organization_id, entity_type, entity_id, work_type, assigned_tech_id, status, priority, notes)
       VALUES ($1, 'RECEIVING', $2, 'TEST', $3, 'ASSIGNED', 100, $4)`,
      [organizationId, receivingId, assignedTechId, notes ?? null]
    );
  }
  return { action: 'upserted' };
}
