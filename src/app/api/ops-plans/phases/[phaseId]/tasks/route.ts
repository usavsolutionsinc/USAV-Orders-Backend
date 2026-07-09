import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { CreateTaskBody } from '@/lib/schemas/ops-plans';
import { createTask } from '@/lib/ops-plans/queries';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  mapOpsPlanError,
  scheduleOpsPlanSideEffects,
} from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ phaseId: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { phaseId } = await params;
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(CreateTaskBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const result = await createTask(gate.ctx.organizationId, phaseId, {
      title: parsed.title,
      assigneeStaffId: parsed.assigneeStaffId ?? null,
      dueAt: parsed.dueAt ?? null,
      notes: parsed.notes ?? null,
      sortOrder: parsed.sortOrder,
      clientEventId: parsed.clientEventId ?? null,
    });
    if (!result) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    scheduleOpsPlanSideEffects(gate.ctx.organizationId, result.planId, 'task_assigned', {
      ctx: gate.ctx,
      req,
      taskId: result.task.id,
      audit: {
        action: AUDIT_ACTION.OPS_PLAN_TASK_CREATE,
        entityType: AUDIT_ENTITY.OPS_PLAN_TASK,
        entityId: result.task.id,
        after: result.task,
      },
    });

    return NextResponse.json(
      { task: result.task, planId: result.planId, idempotent: result.idempotent ?? false },
      { status: result.idempotent ? 200 : 201 },
    );
  } catch (err) {
    const mapped = mapOpsPlanError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
