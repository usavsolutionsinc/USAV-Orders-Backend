import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { startSession } from '@/lib/picking/sessions';

/**
 * POST /api/picking/session
 *
 * Opens a picking session for (order, picker). If an open session already
 * exists for this pair the existing id is returned with `reopen: true`.
 *
 * Body: { order_id: number, device_id?: string }
 */
export const POST = withAuth(async (request, ctx) => {
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  if (actorStaffId == null) {
    return NextResponse.json({ ok: false, error: 'authenticated picker required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const orderId = Number(body?.order_id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order_id' }, { status: 400 });
  }
  const deviceIdRaw = typeof body?.device_id === 'string' ? body.device_id.trim() : '';

  try {
    const result = await startSession({
      orderId,
      pickerStaffId: actorStaffId,
      deviceId: deviceIdRaw || null,
    });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'session start failed';
    console.error('[POST /api/picking/session] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
