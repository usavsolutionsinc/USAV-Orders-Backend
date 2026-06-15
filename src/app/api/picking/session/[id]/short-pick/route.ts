import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordShortPick, type ShortPickReason } from '@/lib/picking/sessions';

const VALID_REASONS: ReadonlySet<ShortPickReason> = new Set([
  'NOT_FOUND_IN_BIN',
  'DAMAGED',
  'WRONG_CONDITION',
  'MISLABELED',
  'INSUFFICIENT_STOCK',
  'OTHER',
]);

/**
 * POST /api/picking/session/[id]/short-pick
 *
 * Records a short pick: releases the allocation back to STOCKED and writes
 * the reason + note to inventory_events for the audit trail.
 *
 * Body: {
 *   allocation_id: number,
 *   picked_qty: number,
 *   planned_qty: number,
 *   reason: ShortPickReason,
 *   note?: string,
 *   client_event_id?: string,
 * }
 */
export const POST = withAuth(async (request, ctx) => {
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  if (actorStaffId == null) {
    return NextResponse.json({ ok: false, error: 'authenticated picker required' }, { status: 401 });
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2]; // …/session/<id>/short-pick
  const sessionId = Number(idStr);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid session id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const allocationId = Number(body?.allocation_id);
  const pickedQty = Number(body?.picked_qty);
  const plannedQty = Number(body?.planned_qty);
  const reason = String(body?.reason || '') as ShortPickReason;
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  const clientEventId =
    typeof body?.client_event_id === 'string' && body.client_event_id.trim() ? body.client_event_id.trim() : null;

  if (!Number.isFinite(allocationId) || allocationId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid allocation_id' }, { status: 400 });
  }
  if (!Number.isFinite(pickedQty) || pickedQty < 0) {
    return NextResponse.json({ ok: false, error: 'invalid picked_qty' }, { status: 400 });
  }
  if (!Number.isFinite(plannedQty) || plannedQty <= 0 || pickedQty >= plannedQty) {
    return NextResponse.json({ ok: false, error: 'picked_qty must be < planned_qty' }, { status: 400 });
  }
  if (!VALID_REASONS.has(reason)) {
    return NextResponse.json({ ok: false, error: `invalid reason: ${reason}` }, { status: 400 });
  }
  if (reason === 'OTHER' && note.length === 0) {
    return NextResponse.json({ ok: false, error: 'reason=OTHER requires a note' }, { status: 400 });
  }

  try {
    // Thread the caller's tenant id so the shared module org-gates the
    // order_unit_allocations read/write (WHERE id=$1 AND organization_id=$2 →
    // 404 on a foreign-org allocation, never 403), runs inside a GUC-wrapped
    // transaction, and forwards orgId to transition() so the serial_units
    // mutation is org-scoped and the release NOTE is stamped to the real tenant
    // — closes the cross-tenant short-pick release-to-STOCKED leak.
    const result = await recordShortPick({
      sessionId,
      allocationId,
      pickedQty,
      plannedQty,
      reason,
      note,
      actorStaffId,
      clientEventId,
    }, ctx.organizationId);
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'short-pick failed';
    console.error('[POST /api/picking/session/[id]/short-pick] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
