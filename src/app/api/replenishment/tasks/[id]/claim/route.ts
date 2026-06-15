import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { claimTask } from '@/lib/replenishment/pick-face';

/**
 * POST /api/replenishment/tasks/[id]/claim
 *
 * Claims a REQUESTED task for the authenticated staffer. Returns 409 if the
 * task is already IN_PROGRESS / COMPLETE / CANCELED.
 */
export const POST = withAuth(async (request, ctx) => {
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  if (actorStaffId == null) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const taskId = Number(idStr);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid task id' }, { status: 400 });
  }

  try {
    const result = await claimTask({ taskId, staffId: actorStaffId }, ctx.organizationId);
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'claim failed';
    console.error('[POST /api/replenishment/tasks/[id]/claim] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'bin.adjust' });
