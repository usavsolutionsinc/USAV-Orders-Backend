import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { completeTask } from '@/lib/ops-plans/queries';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  mapOpsPlanError,
  scheduleOpsPlanSideEffects,
} from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ taskId: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const gateManage = await requireRoutePerm(req, 'operations.plans.manage');
  let gate = gateManage;
  if (gateManage.denied) {
    gate = await requireRoutePerm(req, 'operations.plans.claim');
  }
  if (gate.denied) return gate.denied;

  const isManager = !gateManage.denied;
  const { taskId } = await params;

  try {
    const result = await completeTask(
      gate.ctx.organizationId,
      taskId,
      gate.ctx.staffId,
      { isManager },
    );
    if (!result) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    scheduleOpsPlanSideEffects(gate.ctx.organizationId, result.planId, 'task_completed', {
      ctx: gate.ctx,
      req,
      taskId,
      audit: {
        action: AUDIT_ACTION.OPS_PLAN_TASK_COMPLETE,
        entityType: AUDIT_ENTITY.OPS_PLAN_TASK,
        entityId: taskId,
        after: result.task,
      },
    });

    return NextResponse.json({ task: result.task, planId: result.planId });
  } catch (err) {
    const mapped = mapOpsPlanError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
