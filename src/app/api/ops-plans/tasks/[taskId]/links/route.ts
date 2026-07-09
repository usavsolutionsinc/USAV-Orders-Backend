import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { CreateTaskLinkBody } from '@/lib/schemas/ops-plans';
import { createTaskLink } from '@/lib/ops-plans/task-links';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  scheduleOpsPlanSideEffects,
} from '@/lib/ops-plans/side-effects';
import { getTaskContext } from '@/lib/ops-plans/queries';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ taskId: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { taskId } = await params;
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(CreateTaskLinkBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const link = await createTaskLink(gate.ctx.organizationId, taskId, parsed);
  if (!link) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const ctx = await getTaskContext(gate.ctx.organizationId, taskId);
  if (ctx) {
    scheduleOpsPlanSideEffects(gate.ctx.organizationId, ctx.planId, 'plan_updated', {
      ctx: gate.ctx,
      req,
      taskId,
      audit: {
        action: AUDIT_ACTION.OPS_PLAN_TASK_LINK,
        entityType: AUDIT_ENTITY.OPS_PLAN_TASK,
        entityId: taskId,
        after: link,
      },
    });
  }

  return NextResponse.json({ link }, { status: 201 });
}
