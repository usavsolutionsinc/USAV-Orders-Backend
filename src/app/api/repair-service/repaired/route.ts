import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';

/**
 * POST /api/repair-service/repaired
 *
 * Marks a repair work_assignment as DONE and captures the tech's
 * description of what was repaired in work_assignments.repair_outcome.
 *
 * Body:
 * {
 *   repairId: number,
 *   assignmentId?: number | null,
 *   repairedPart: string,
 *   completedByTechId?: number | null,
 *   assignedTechId?: number | null
 * }
 */
export async function POST(req: NextRequest) {
  const client = await pool.connect();

  try {
    const { repairId, assignmentId, repairedPart, completedByTechId, assignedTechId } = await req.json();

    if (!repairId) {
      return NextResponse.json({ error: 'repairId is required' }, { status: 400 });
    }

    const repairOutcome = String(repairedPart || '').trim();
    if (!repairOutcome) {
      return NextResponse.json({ error: 'repairedPart is required' }, { status: 400 });
    }

    const completedBy = Number.isFinite(Number(completedByTechId)) && Number(completedByTechId) > 0
      ? Number(completedByTechId)
      : null;
    const assignedTech = Number.isFinite(Number(assignedTechId)) && Number(assignedTechId) > 0
      ? Number(assignedTechId)
      : completedBy;

    await client.query('BEGIN');

    if (assignmentId) {
      await client.query(
        `UPDATE work_assignments
            SET assigned_tech_id      = COALESCE($1, assigned_tech_id),
                status                = 'DONE',
                started_at            = COALESCE(started_at, NOW()),
                repair_outcome        = $2,
                completed_by_tech_id  = COALESCE($3, completed_by_tech_id, assigned_tech_id),
                completed_at          = COALESCE(completed_at, NOW()),
                updated_at            = NOW()
          WHERE id = $4
            AND entity_type = 'REPAIR'`,
        [assignedTech, repairOutcome, completedBy, assignmentId],
      );
    } else {
      await client.query(
        `INSERT INTO work_assignments
              (entity_type, entity_id, work_type, assigned_tech_id, status, priority, assigned_at, started_at, completed_at, completed_by_tech_id, repair_outcome)
         VALUES ('REPAIR', $1, 'REPAIR', $2, 'DONE', 100, NOW(), NOW(), NOW(), $3, $4)`,
        [repairId, assignedTech, completedBy, repairOutcome],
      );
    }

    await client.query(
      `UPDATE repair_service
          SET status = 'Repaired, Contact Customer',
              status_history = CASE
                WHEN COALESCE(status, '') IS DISTINCT FROM 'Repaired, Contact Customer' THEN
                  COALESCE(status_history, '[]'::jsonb) || jsonb_build_array(
                    jsonb_strip_nulls(
                      jsonb_build_object(
                        'status', 'Repaired, Contact Customer',
                        'timestamp', $2,
                        'previous_status', NULLIF(status, ''),
                        'source', 'repair-service.repaired',
                        'user_id', $3,
                        'metadata', jsonb_build_object(
                          'assignment_id', $4,
                          'repair_outcome', $5
                        )
                      )
                    )
                  )
                ELSE COALESCE(status_history, '[]'::jsonb)
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [
        repairId,
        formatPSTTimestamp(),
        completedBy,
        assignmentId ?? null,
        repairOutcome,
      ],
    );

    await client.query('COMMIT');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('POST /api/repair-service/repaired error:', error);
    return NextResponse.json(
      { error: 'Failed to mark repair as repaired', details: error.message },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
