import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { UpdateTaskBody } from '@/lib/schemas/ops-plans';
import { updateTask } from '@/lib/ops-plans/queries';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  mapOpsPlanError,
  scheduleOpsPlanSideEffects,
} from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ taskId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { taskId } = await params;
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(UpdateTaskBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const result = await updateTask(gate.ctx.organizationId, taskId, {
      ...parsed,
      actorStaffId: gate.ctx.staffId,
    });
    if (!result) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const event = parsed.status === 'done'
      ? 'task_completed'
      : parsed.assigneeStaffId != null
        ? 'task_assigned'
        : 'plan_updated';

    scheduleOpsPlanSideEffects(gate.ctx.organizationId, result.planId, event, {
      ctx: gate.ctx,
      req,
      taskId,
      audit: {
        action: parsed.status === 'canceled'
          ? AUDIT_ACTION.OPS_PLAN_TASK_CANCEL
          : parsed.assigneeStaffId != null
            ? AUDIT_ACTION.OPS_PLAN_TASK_ASSIGN
            : AUDIT_ACTION.OPS_PLAN_TASK_COMPLETE,
        entityType: AUDIT_ENTITY.OPS_PLAN_TASK,
        entityId: taskId,
        after: result.task,
        reasonCode: parsed.status === 'canceled' ? 'supervisor_cancel' : undefined,
      },
    });

    return NextResponse.json({ task: result.task, planId: result.planId });
  } catch (err) {
    const mapped = mapOpsPlanError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
