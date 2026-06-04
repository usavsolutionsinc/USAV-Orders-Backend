import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { hasStepUp } from '@/lib/auth/stepup';
import { rolesIncludeAdmin } from '@/lib/auth/permissions-shared';
import {
  getOrderById,
  updateOrder,
  deleteOrder,
} from '@/lib/neon/orders-queries';
import { parseBody } from '@/lib/schemas/parse';
import { OrderUpdateBody } from '@/lib/schemas/orders';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * Canonical record route for a single order. Sits alongside the workflow verb
 * routes (`[id]/allocate`, `[id]/release`, `[id]/pick-tasks`, plus the
 * collection-level add/assign/skip/start/verify):
 *   GET    — fetch the order row                        (orders.view)
 *   PATCH  — edit record fields (whitelisted)           (orders.create)
 *   DELETE — hard-delete the order                      (orders.void, step-up)
 *
 * Orders have no soft-delete column, so DELETE mirrors POST /api/orders/delete:
 * a hard delete with a full before-snapshot audit row. Because `requireRoutePerm`
 * does NOT enforce step-up (the static wrapper does), we re-check the step-up
 * grant here so the destructive path stays step-up-protected.
 */

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'orders.view');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
    }

    const order = await getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error('[GET /api/orders/[id]] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order', details: error?.message },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'orders.create');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(OrderUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getOrderById(id);
    if (!before) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const updated = await updateOrder(id, parsed);
    if (!updated) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    await invalidateCacheTags(['orders', 'shipped', 'packing-logs']);
    await publishOrderChanged({ orderIds: [id], source: 'orders.update' });

    await recordAudit(pool, gate.ctx, req, {
      source: 'orders-api',
      action: AUDIT_ACTION.ORDER_UPDATE,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: id,
      before: { ...before },
      after: { ...updated },
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (error: any) {
    console.error('[PATCH /api/orders/[id]] error:', error);
    return NextResponse.json(
      { error: 'Failed to update order', details: error?.message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'orders.void');
    if (gate.denied) return gate.denied;

    // orders.void is step-up-protected. requireRoutePerm checks the permission
    // but not the fresh step-up grant, so enforce that grant here too — except
    // for admins, who are exempt from step-up (PIN / passkey) prompts.
    if (!rolesIncludeAdmin(gate.ctx.user.roles)) {
      const granted = await hasStepUp(gate.ctx.session.sid, 'orders.void');
      if (!granted) {
        return NextResponse.json(
          { error: 'STEPUP_REQUIRED', scope: 'orders.void', method_hint: 'pin' },
          { status: 403 },
        );
      }
    }

    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
    }

    const before = await getOrderById(id);
    if (!before) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const deleted = await deleteOrder(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    await invalidateCacheTags(['orders', 'shipped', 'packing-logs']);
    await publishOrderChanged({ orderIds: [id], source: 'orders.delete' });

    await recordAudit(pool, gate.ctx, req, {
      source: 'orders-api',
      action: 'orders.delete',
      entityType: AUDIT_ENTITY.ORDER,
      entityId: id,
      before: { ...before },
      after: null,
      method: 'manual',
    });

    return NextResponse.json({ success: true, deleted: 1 });
  } catch (error: any) {
    console.error('[DELETE /api/orders/[id]] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete order', details: error?.message },
      { status: 500 },
    );
  }
}
