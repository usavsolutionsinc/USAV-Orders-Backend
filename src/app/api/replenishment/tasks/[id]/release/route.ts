import { NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { releaseTask } from '@/lib/replenishment/pick-face';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

const paramsSchema = z.object({
  taskId: z.coerce.number().int().positive(),
});

/**
 * POST /api/replenishment/tasks/[id]/release
 *
 * Reversibility 5.7 — undo a claim: an IN_PROGRESS task returns to REQUESTED
 * and its assigned_staff_id is cleared, so another operator can pick it up.
 * 404 when the task doesn't exist (or belongs to another org); 409 when the
 * task is not IN_PROGRESS.
 */
export const POST = withAuth(async (request, ctx) => {
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  if (actorStaffId == null) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const parsed = paramsSchema.safeParse({ taskId: segments[segments.length - 2] });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid task id' }, { status: 400 });
  }
  const { taskId } = parsed.data;

  try {
    const result = await releaseTask({ taskId }, ctx.organizationId);
    if (!result.ok) return NextResponse.json(result, { status: result.status });

    await recordAudit(pool, ctx, request, {
      source: 'replenishment-tasks',
      action: AUDIT_ACTION.REPLENISH_TASK_RELEASE,
      entityType: AUDIT_ENTITY.REPLENISHMENT_TASK,
      entityId: taskId,
      after: { status: 'REQUESTED', assigned_staff_id: null },
      method: 'manual',
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'release failed';
    console.error('[POST /api/replenishment/tasks/[id]/release] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'bin.adjust' });
