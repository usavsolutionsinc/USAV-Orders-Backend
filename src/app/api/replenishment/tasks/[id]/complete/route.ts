import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Replenishment } from '@/lib/feature-flags';
import { completeTask } from '@/lib/replenishment/pick-face';

/**
 * POST /api/replenishment/tasks/[id]/complete
 *
 * Marks an IN_PROGRESS task complete, applies the bin_contents move
 * (source decrement + target increment), and emits an inventory_events row
 * — all atomically.
 *
 * Body: { qty_moved: number }
 * Gated by INVENTORY_V2_REPLENISHMENT.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Replenishment()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_REPLENISHMENT flag is OFF', flag: 'INVENTORY_V2_REPLENISHMENT' },
      { status: 503 },
    );
  }
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

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const qtyMoved = Number(body?.qty_moved);
  if (!Number.isFinite(qtyMoved) || qtyMoved <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid qty_moved' }, { status: 400 });
  }

  try {
    const result = await completeTask({ taskId, qtyMoved, actorStaffId });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'complete failed';
    console.error('[POST /api/replenishment/tasks/[id]/complete] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'bin.adjust' });
