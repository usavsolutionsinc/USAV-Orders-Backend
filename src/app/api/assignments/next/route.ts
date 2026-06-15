import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parsePositiveInt } from '@/utils/number';

const WORK_TYPES = new Set(['TEST', 'PACK', 'REPAIR', 'QA', 'RECEIVE']);

export const GET = withAuth(async (request: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const { searchParams } = new URL(request.url);

    // Accept either the specific new column params or the legacy staff_id param
    const assignedTechId = parsePositiveInt(searchParams.get('assigned_tech_id') ?? searchParams.get('staff_id'));
    const assignedPackerId = parsePositiveInt(searchParams.get('assigned_packer_id') ?? searchParams.get('staff_id'));
    const workType = String(searchParams.get('work_type') || '').trim().toUpperCase();

    if (!WORK_TYPES.has(workType)) {
      return NextResponse.json({ success: false, error: 'Valid work_type is required' }, { status: 400 });
    }

    const isPackWork = workType === 'PACK';
    const staffId    = isPackWork ? assignedPackerId : assignedTechId;
    const col        = isPackWork ? 'assigned_packer_id' : 'assigned_tech_id';

    if (staffId === null) {
      return NextResponse.json(
        { success: false, error: `Valid ${col} is required` },
        { status: 400 }
      );
    }

    const result = await tenantQuery(
      orgId,
      `SELECT *
       FROM work_assignments
       WHERE ${col} = $1
         AND work_type = $2
         AND status IN ('ASSIGNED', 'IN_PROGRESS')
         AND organization_id = $3
       ORDER BY
         CASE WHEN status = 'IN_PROGRESS' THEN 0 ELSE 1 END,
         priority ASC,
         assigned_at ASC
       LIMIT 1`,
      [staffId, workType, orgId]
    );

    return NextResponse.json({ success: true, assignment: result.rows[0] || null });
  } catch (error: any) {
    console.error('Failed to fetch next assignment:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch next assignment' },
      { status: 500 }
    );
  }
}, { permission: 'work_orders.view' });
