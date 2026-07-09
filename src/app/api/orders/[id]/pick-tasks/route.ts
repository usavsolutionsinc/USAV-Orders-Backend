import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { loadPickTasks } from '@/lib/picking/sessions';

/**
 * GET /api/orders/[id]/pick-tasks
 *
 * Returns the picker's task list for an order: one row per open allocation,
 * sorted to match the order the picker should walk the warehouse in.
 */
export const GET = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2]; // …/orders/<id>/pick-tasks
  const orderId = Number(idStr);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }

  try {
    // Org-ownership precheck on the [id] before delegating: orders is tenant-owned,
    // so a cross-tenant id reads back nothing → 404 (never 403).
    const ownQ = await tenantQuery<{ id: number }>(
      ctx.organizationId,
      'SELECT id FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1',
      [orderId, ctx.organizationId],
    );
    if (ownQ.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'order not found' }, { status: 404 });
    }

    // Pass the org id so loadPickTasks takes its GUC-scoped branch (explicit
    // organization_id predicates on the sku_catalog / locations / sku_platform_ids
    // string joins) instead of the legacy unscoped raw-pool reads.
    const tasks = await loadPickTasks(orderId, ctx.organizationId);
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
