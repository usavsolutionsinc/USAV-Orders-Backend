import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { UpdatePlanBody } from '@/lib/schemas/ops-plans';
import { archivePlan, getPlanDetail, updatePlan } from '@/lib/ops-plans/queries';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  mapOpsPlanError,
  scheduleOpsPlanSideEffects,
} from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.view');
  if (gate.denied) return gate.denied;
  const { id } = await params;
  const detail = await getPlanDetail(gate.ctx.organizationId, id);
  if (!detail) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { id } = await params;
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(UpdatePlanBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const before = await getPlanDetail(gate.ctx.organizationId, id);
    const plan = await updatePlan(gate.ctx.organizationId, id, parsed);
    if (!plan) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    scheduleOpsPlanSideEffects(gate.ctx.organizationId, id, 'plan_updated', {
      ctx: gate.ctx,
      req,
      audit: {
        action: parsed.status === 'archived' ? AUDIT_ACTION.OPS_PLAN_ARCHIVE : AUDIT_ACTION.OPS_PLAN_UPDATE,
        entityType: AUDIT_ENTITY.OPS_PLAN,
        entityId: id,
        before: before?.plan ?? null,
        after: plan,
      },
    });
    return NextResponse.json({ plan });
  } catch (err) {
    const mapped = mapOpsPlanError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { id } = await params;
  const ok = await archivePlan(gate.ctx.organizationId, id);
  if (!ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  scheduleOpsPlanSideEffects(gate.ctx.organizationId, id, 'plan_updated', {
    ctx: gate.ctx,
    req,
    audit: {
      action: AUDIT_ACTION.OPS_PLAN_ARCHIVE,
      entityType: AUDIT_ENTITY.OPS_PLAN,
      entityId: id,
      after: { status: 'archived' },
    },
  });
  return NextResponse.json({ success: true });
}
