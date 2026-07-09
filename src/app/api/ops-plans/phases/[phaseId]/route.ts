import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { UpdatePhaseBody } from '@/lib/schemas/ops-plans';
import { deletePhase, updatePhase } from '@/lib/ops-plans/queries';
import { scheduleOpsPlanSideEffects } from '@/lib/ops-plans/side-effects';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ phaseId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { phaseId } = await params;
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(UpdatePhaseBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const phase = await updatePhase(gate.ctx.organizationId, phaseId, parsed);
  if (!phase) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  scheduleOpsPlanSideEffects(gate.ctx.organizationId, phase.planId, 'plan_updated', { ctx: gate.ctx, req });
  return NextResponse.json({ phase });
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { phaseId } = await params;
  const ok = await deletePhase(gate.ctx.organizationId, phaseId);
  if (!ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true });
}
