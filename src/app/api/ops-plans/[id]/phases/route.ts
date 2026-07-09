import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { CreatePhaseBody } from '@/lib/schemas/ops-plans';
import { createPhase, getPlanDetail } from '@/lib/ops-plans/queries';
import { scheduleOpsPlanSideEffects } from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { id: planId } = await params;
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(CreatePhaseBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const phase = await createPhase(gate.ctx.organizationId, planId, parsed);
  if (!phase) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  scheduleOpsPlanSideEffects(gate.ctx.organizationId, planId, 'plan_updated', { ctx: gate.ctx, req });
  const detail = await getPlanDetail(gate.ctx.organizationId, planId);
  return NextResponse.json({ phase, detail }, { status: 201 });
}
