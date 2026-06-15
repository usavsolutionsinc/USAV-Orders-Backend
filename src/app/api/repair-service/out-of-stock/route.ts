import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * POST /api/repair-service/out-of-stock
 *
 * Records a missing part that is blocking this repair.
 * Stores the text in work_assignments.out_of_stock on the active wa row.
 *
 * Body: { repairId: number, assignmentId?: number | null, part: string }
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const { repairId, assignmentId, part } = await req.json();

    if (!repairId) {
      return NextResponse.json({ error: 'repairId is required' }, { status: 400 });
    }
    if (!part || !String(part).trim()) {
      return NextResponse.json({ error: 'part description is required' }, { status: 400 });
    }

    const partText = String(part).trim();

    if (assignmentId) {
      await tenantQuery(
        orgId,
        `UPDATE work_assignments
            SET out_of_stock = $1,
                updated_at   = NOW()
          WHERE id          = $2
            AND entity_type = 'REPAIR'
            AND organization_id = $3`,
        [partText, assignmentId, orgId],
      );
    } else {
      // The active unique index ux_work_assignments_active_entity is on
      // (entity_type, entity_id, work_type) and does NOT include organization_id,
      // so the ON CONFLICT target spans tenants. Because repair_service.id is a
      // single global sequence, a guessed repairId could collide with another
      // org's active REPAIR row. Pre-validate that repairId belongs to this org,
      // and guard the DO UPDATE with organization_id so a cross-tenant conflict
      // row can never be overwritten (the INSERT path would 0-row on conflict
      // with a foreign org, never reaching here because we 404 first).
      const owner = await tenantQuery(
        orgId,
        `SELECT 1
           FROM repair_service
          WHERE id = $1
            AND organization_id = $2
          LIMIT 1`,
        [repairId, orgId],
      );
      if (owner.rowCount === 0) {
        return NextResponse.json({ error: 'Repair not found' }, { status: 404 });
      }

      await tenantQuery(
        orgId,
        `INSERT INTO work_assignments
              (entity_type, entity_id, work_type, status, out_of_stock, priority, assigned_at, organization_id)
         VALUES ('REPAIR', $1, 'REPAIR', 'ASSIGNED', $2, 100, NOW(), $3)
         ON CONFLICT (entity_type, entity_id, work_type)
         WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
         DO UPDATE SET
           out_of_stock = EXCLUDED.out_of_stock,
           updated_at   = NOW()
         WHERE work_assignments.organization_id = $3`,
        [repairId, partText, orgId],
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
}, { permission: 'repair.mark_repaired' });
