import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Picking } from '@/lib/feature-flags';
import { loadPickTasks } from '@/lib/picking/sessions';

/**
 * GET /api/orders/[id]/pick-tasks
 *
 * Returns the picker's task list for an order: one row per open allocation,
 * sorted to match the order the picker should walk the warehouse in.
 *
 * Gated by INVENTORY_V2_PICKING.
 */
export const GET = withAuth(async (request) => {
  if (!isInventoryV2Picking()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_PICKING flag is OFF', flag: 'INVENTORY_V2_PICKING' },
      { status: 503 },
    );
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2]; // …/orders/<id>/pick-tasks
  const orderId = Number(idStr);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }

  try {
    const tasks = await loadPickTasks(orderId);
    if (!tasks) {
      return NextResponse.json({ ok: false, error: 'order not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'pick-tasks failed';
    console.error('[GET /api/orders/[id]/pick-tasks] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
