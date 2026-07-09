import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { deleteTaskLink } from '@/lib/ops-plans/task-links';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ taskId: string; linkId: string }> };

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const gate = await requireRoutePerm(req, 'operations.plans.manage');
  if (gate.denied) return gate.denied;
  const { linkId } = await params;
  const ok = await deleteTaskLink(gate.ctx.organizationId, linkId);
  if (!ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true });
}
