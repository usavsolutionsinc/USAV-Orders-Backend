import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { claimTask } from '@/lib/ops-plans/queries';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  mapOpsPlanError,
  scheduleOpsPlanSideEffects,
} from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ taskId: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.claim');
  if (gate.denied) return gate.denied;
  const { taskId } = await params;

  try {
    const result = await claimTask(gate.ctx.organizationId, taskId, gate.ctx.staffId);
    if (!result) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    scheduleOpsPlanSideEffects(gate.ctx.organizationId, result.planId, 'task_assigned', {
      ctx: gate.ctx,
      req,
      taskId,
      audit: {
        action: AUDIT_ACTION.OPS_PLAN_TASK_ASSIGN,
        entityType: AUDIT_ENTITY.OPS_PLAN_TASK,
        entityId: taskId,
        after: { assigneeStaffId: gate.ctx.staffId, status: 'in_progress' },
      },
    });

    return NextResponse.json({ task: result.task, planId: result.planId });
  } catch (err) {
    const mapped = mapOpsPlanError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
