import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/repair-service/start
 *
 * Marks a repair work_assignment as IN_PROGRESS and captures the tech's
 * description of what they found / are performing (repair_outcome).
 *
 * Body: { repairId: number, assignmentId?: number | null, outcome: string }
 *
 * If assignmentId is supplied the existing row is updated in-place.
 * Otherwise an INSERT … ON CONFLICT upsert creates or updates the active row.
 */
export async function POST(req: NextRequest) {
  try {
    const { repairId, assignmentId, outcome } = await req.json();

    if (!repairId) {
      return NextResponse.json({ error: 'repairId is required' }, { status: 400 });
    }

    const outcomeText = String(outcome || '').trim() || null;

    if (assignmentId) {
      await pool.query(
        `UPDATE work_assignments
            SET status         = 'IN_PROGRESS',
                started_at     = COALESCE(started_at, NOW()),
                repair_outcome = $1,
                updated_at     = NOW()
          WHERE id          = $2
            AND entity_type = 'REPAIR'`,
        [outcomeText, assignmentId],
      );
    } else {
      // Upsert: create active row if missing, or advance existing OPEN/ASSIGNED row.
      // The partial unique index ux_work_assignments_active_entity covers
      // (entity_type, entity_id, work_type) WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS').
      await pool.query(
        `INSERT INTO work_assignments
              (entity_type, entity_id, work_type, status, started_at, repair_outcome, priority, assigned_at)
         VALUES ('REPAIR', $1, 'REPAIR', 'IN_PROGRESS', NOW(), $2, 100, NOW())
         ON CONFLICT (entity_type, entity_id, work_type)
         WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
         DO UPDATE SET
           status         = 'IN_PROGRESS',
           started_at     = COALESCE(work_assignments.started_at, NOW()),
           repair_outcome = EXCLUDED.repair_outcome,
           updated_at     = NOW()`,
        [repairId, outcomeText],
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/repair-service/start error:', error);
    return NextResponse.json(
      { error: 'Failed to start repair', details: error.message },
      { status: 500 },
    );
  }
}
