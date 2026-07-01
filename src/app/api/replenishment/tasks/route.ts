import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { listOpenTasks } from '@/lib/replenishment/pick-face';

/**
 * GET /api/replenishment/tasks
 *
 * Returns open replenishment tasks (REQUESTED + IN_PROGRESS) ordered by
 * detected_at ascending so the oldest unfulfilled need is at the top.
 */
export const GET = withAuth(async (_req, ctx) => {
  try {
    const tasks = await listOpenTasks(ctx.organizationId);
    return NextResponse.json({ ok: true, tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'list tasks failed';
    console.error('[GET /api/replenishment/tasks] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'bin.adjust' });
