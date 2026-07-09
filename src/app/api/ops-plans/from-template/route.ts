import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { CreatePlanFromTemplateBody } from '@/lib/schemas/ops-plans';
import { createPlanFromTemplate } from '@/lib/ops-plans/queries';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  scheduleOpsPlanSideEffects,
} from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(CreatePlanFromTemplateBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const detail = await createPlanFromTemplate(ctx.organizationId, parsed.templateKey, {
    title: parsed.title,
    createdByStaffId: ctx.staffId,
  });
  if (!detail) {
    return NextResponse.json({ error: 'TEMPLATE_NOT_FOUND' }, { status: 404 });
  }

  scheduleOpsPlanSideEffects(ctx.organizationId, detail.plan.id, 'plan_updated', {
    ctx,
    req,
    audit: {
      action: AUDIT_ACTION.OPS_PLAN_CREATE,
      entityType: AUDIT_ENTITY.OPS_PLAN,
      entityId: detail.plan.id,
      after: { templateKey: parsed.templateKey, title: detail.plan.title },
    },
  });

  return NextResponse.json(detail, { status: 201 });
}, { permission: 'operations.plans.manage' });
