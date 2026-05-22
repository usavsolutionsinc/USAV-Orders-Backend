import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { confirmPick } from '@/lib/picking/sessions';

/**
 * POST /api/picking/session/[id]/confirm-pick
 *
 * Records a confirmed pick for one allocation: flips the unit
 * ALLOCATED → PICKED via the state machine and the allocation row's `state`
 * column in one transaction.
 *
 * Body: { allocation_id: number, client_event_id?: string }
 */
export const POST = withAuth(async (request, ctx) => {
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  if (actorStaffId == null) {
    return NextResponse.json({ ok: false, error: 'authenticated picker required' }, { status: 401 });
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2]; // …/session/<id>/confirm-pick
  const sessionId = Number(idStr);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid session id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const allocationId = Number(body?.allocation_id);
  if (!Number.isFinite(allocationId) || allocationId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid allocation_id' }, { status: 400 });
  }
  const clientEventId =
    typeof body?.client_event_id === 'string' && body.client_event_id.trim() ? body.client_event_id.trim() : null;

  try {
    const result = await confirmPick({
      sessionId,
      allocationId,
      actorStaffId,
      clientEventId,
    });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'confirm-pick failed';
    console.error('[POST /api/picking/session/[id]/confirm-pick] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
