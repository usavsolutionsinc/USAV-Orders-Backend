import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/repair-service/out-of-stock
 *
 * Records a missing part that is blocking this repair.
 * Stores the text in work_assignments.out_of_stock on the active wa row.
 *
 * Body: { repairId: number, assignmentId?: number | null, part: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { repairId, assignmentId, part } = await req.json();

    if (!repairId) {
      return NextResponse.json({ error: 'repairId is required' }, { status: 400 });
    }
    if (!part || !String(part).trim()) {
      return NextResponse.json({ error: 'part description is required' }, { status: 400 });
    }

    const partText = String(part).trim();

    if (assignmentId) {
      await pool.query(
        `UPDATE work_assignments
            SET out_of_stock = $1,
                updated_at   = NOW()
          WHERE id          = $2
            AND entity_type = 'REPAIR'`,
        [partText, assignmentId],
      );
    } else {
      await pool.query(
        `INSERT INTO work_assignments
              (entity_type, entity_id, work_type, status, out_of_stock, priority, assigned_at)
         VALUES ('REPAIR', $1, 'REPAIR', 'ASSIGNED', $2, 100, NOW())
         ON CONFLICT (entity_type, entity_id, work_type)
         WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
         DO UPDATE SET
           out_of_stock = EXCLUDED.out_of_stock,
           updated_at   = NOW()`,
        [repairId, partText],
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/repair-service/out-of-stock error:', error);
    return NextResponse.json(
      { error: 'Failed to record out of stock', details: error.message },
      { status: 500 },
    );
  }
}
