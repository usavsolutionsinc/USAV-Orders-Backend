import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Picking } from '@/lib/feature-flags';
import { completeSession } from '@/lib/picking/sessions';

/**
 * POST /api/picking/session/[id]/complete
 *
 * Closes an open picking session. Idempotent — a 404 is returned if the
 * session is already closed or does not exist.
 *
 * Gated by INVENTORY_V2_PICKING.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Picking()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_PICKING flag is OFF', flag: 'INVENTORY_V2_PICKING' },
      { status: 503 },
    );
  }

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  if (actorStaffId == null) {
    return NextResponse.json({ ok: false, error: 'authenticated picker required' }, { status: 401 });
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2]; // …/session/<id>/complete
  const sessionId = Number(idStr);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid session id' }, { status: 400 });
  }

  try {
    const result = await completeSession({ sessionId, actorStaffId });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'session complete failed';
    console.error('[POST /api/picking/session/[id]/complete] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
