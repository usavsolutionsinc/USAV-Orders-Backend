import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { allocateOrder, isValidConditionGrade } from '@/lib/inventory/allocate';

/**
 * POST /api/orders/[id]/allocate
 *
 * Phase 4 of the inventory v2 plan. Reserves specific serial_units for an
 * order line. FIFO by serial_units.id within (sku, optional condition_grade)
 * among rows where current_status='STOCKED'.
 *
 * Body:
 *   {
 *     quantity?: number,        // override orders.quantity for partial alloc
 *     condition_grade?: 'BRAND_NEW' | 'USED_A' | 'USED_B' | 'USED_C' | 'PARTS',
 *     client_event_id?: string  // UUID, idempotent retries
 *   }
 *
 * The allocation transaction itself lives in src/lib/inventory/allocate.ts
 * so the bulk-allocate admin page can call the same code path.
 *
 * Permission: orders.view.
 */
export const POST = withAuth(async (request, ctx) => {
  // Parse the [id] segment from the URL — Next 16 route params via the
  // wrapper would require a different overload of withAuth; this is fine.
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const orderId = Number(idStr);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const qtyOverride = Number(body?.quantity);
  const conditionGradeInput = String(body?.condition_grade || '').trim().toUpperCase();
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  if (conditionGradeInput && !isValidConditionGrade(conditionGradeInput)) {
    return NextResponse.json(
      { ok: false, error: `condition_grade must be BRAND_NEW | USED_A | USED_B | USED_C | PARTS` },
      { status: 400 },
    );
  }

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    // Pass ctx.organizationId so allocateOrder runs inside a tenant-scoped
    // transaction: the order load is org-gated (cross-tenant id → 404), the
    // candidate serial_units selection is org-scoped (the su.sku string join
    // can't reach another tenant's stock), and the order_unit_allocations
    // INSERT is org-stamped.
    const result = await allocateOrder({
      orderId,
      quantity: Number.isFinite(qtyOverride) && qtyOverride > 0 ? qtyOverride : undefined,
      conditionGrade: conditionGradeInput ? (conditionGradeInput as 'BRAND_NEW') : null,
      clientEventId,
      actorStaffId,
    }, ctx.organizationId);

    if (!result.ok) {
      return NextResponse.json(result, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'allocation failed';
    console.error('[POST /api/orders/[id]/allocate] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
