import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { CreatePlanBody } from '@/lib/schemas/ops-plans';
import { createPlan, listPlans } from '@/lib/ops-plans/queries';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  mapOpsPlanError,
  scheduleOpsPlanSideEffects,
} from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

export const GET = withAuth(async (req, ctx) => {
  const status = req.nextUrl.searchParams.get('status');
  const q = req.nextUrl.searchParams.get('q');
  const result = await listPlans(ctx.organizationId, { status, q });
  return NextResponse.json(result);
}, { permission: 'operations.plans.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(CreatePlanBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const { plan } = await createPlan(ctx.organizationId, {
      title: parsed.title,
      description: parsed.description ?? null,
      targetDate: parsed.targetDate ?? null,
      createdByStaffId: ctx.staffId,
    });
    scheduleOpsPlanSideEffects(ctx.organizationId, plan.id, 'plan_updated', {
      ctx,
      req,
      audit: {
        action: AUDIT_ACTION.OPS_PLAN_CREATE,
        entityType: AUDIT_ENTITY.OPS_PLAN,
        entityId: plan.id,
        after: { title: plan.title, status: plan.status },
      },
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    const mapped = mapOpsPlanError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}, { permission: 'operations.plans.manage' });
