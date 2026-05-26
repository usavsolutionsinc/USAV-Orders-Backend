import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { findByNormalizedSerial } from '@/lib/neon/serial-units-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';
import {
  allocate,
  findOpenAllocationForUnit,
  release,
} from '@/lib/repositories/inventory/allocations';

/**
 * POST /api/serial-units/[id]/allocate — pair a unit with an order.
 *
 * Resolves the unit by numeric `serial_units.id` or by `normalized_serial`,
 * resolves the order by numeric `orders.id` or by the textual `orders.order_id`,
 * and inserts an `order_unit_allocations` row in state ALLOCATED. Emits an
 * `inventory_events` ALLOCATED row in the same logical step so the History
 * Log timeline picks it up.
 *
 * Concurrency: the partial UNIQUE `idx_oua_open_unit` rejects a second open
 * allocation for the same unit. If the unit already has an open row we
 * return 409 by default — the caller can pass `transfer: true` to release
 * the prior allocation (reason='REASSIGNED') and then allocate to the new
 * order in the same request.
 *
 * Body:
 *   {
 *     order_pk?: number;        // orders.id — preferred when known
 *     order_ref?: string;       // orders.order_id (the human/business id)
 *     transfer?: boolean;       // auto-release any open allocation first
 *     client_event_id?: string; // idempotency key for the inventory_event
 *   }
 */
export const POST = withAuth(
  async (request: NextRequest, ctx) => {
    const idParam = extractIdSegment(request.nextUrl.pathname);
    if (!idParam) {
      return NextResponse.json({ error: 'serial unit id or serial number required' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const orderPk =
      typeof body.order_pk === 'number' && Number.isFinite(body.order_pk) ? body.order_pk : null;
    const orderRef =
      typeof body.order_ref === 'string' && body.order_ref.trim() ? body.order_ref.trim() : null;
    const transfer = body.transfer === true;
    const clientEventId =
      typeof body.client_event_id === 'string' ? body.client_event_id : null;

    if (orderPk == null && !orderRef) {
      return NextResponse.json(
        { error: 'order_pk or order_ref is required' },
        { status: 400 },
      );
    }

    // 1. Resolve the unit.
    const unit = await resolveUnit(idParam);
    if (!unit) {
      return NextResponse.json({ error: 'Serial unit not found' }, { status: 404 });
    }

    // 2. Resolve the order.
    const order = await resolveOrder({ orderPk, orderRef });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // 3. Check for an existing open allocation.
    const prior = await findOpenAllocationForUnit(unit.id);
    if (prior && prior.orderId === order.id) {
      // Already paired with this exact order — idempotent return.
      return NextResponse.json({
        success: true,
        allocation: prior,
        order_id: order.id,
        order_ref: order.order_id,
        already_allocated: true,
      });
    }
    if (prior && !transfer) {
      return NextResponse.json(
        {
          error: 'Unit already allocated',
          allocation: prior,
          hint: 'Re-send with `transfer: true` to reassign.',
        },
        { status: 409 },
      );
    }

    // 4. Optionally release the prior allocation. Emit a RELEASED event so
    //    the timeline reflects the transfer rather than a silent flip.
    if (prior && transfer) {
      await release({ allocationId: prior.id, reason: 'REASSIGNED' });
      try {
        await recordInventoryEvent({
          event_type: 'RELEASED',
          actor_staff_id: ctx.staffId ?? null,
          station: 'MOBILE',
          serial_unit_id: unit.id,
          sku: unit.sku,
          notes: 'Released to reassign to a different order',
          payload: {
            allocation_id: prior.id,
            released_order_id: prior.orderId,
            reason: 'REASSIGNED',
          },
        });
      } catch (err) {
        console.warn('[allocate] RELEASED event failed (non-fatal)', err);
      }
    }

    // 5. Allocate. The partial unique index will throw if another writer
    //    raced us — surface that as a 409.
    let allocation;
    try {
      allocation = await allocate({
        orderId: order.id,
        serialUnitId: unit.id,
        allocatedByStaffId: ctx.staffId ?? null,
      });
    } catch (err) {
      console.error('[allocate] insert failed', err);
      const msg = err instanceof Error ? err.message : 'Allocation failed';
      const isUniqueViolation = /idx_oua_open_unit|unique/i.test(msg);
      return NextResponse.json(
        { error: isUniqueViolation ? 'Unit was just allocated by another scanner' : msg },
        { status: isUniqueViolation ? 409 : 500 },
      );
    }

    // 6. Lifecycle event — pairs the unit↔order in the History Log timeline.
    try {
      await recordInventoryEvent({
        event_type: 'ALLOCATED',
        actor_staff_id: ctx.staffId ?? null,
        station: 'MOBILE',
        serial_unit_id: unit.id,
        sku: unit.sku,
        client_event_id: clientEventId,
        payload: {
          allocation_id: allocation.id,
          order_id: order.id,
          order_ref: order.order_id,
          transferred_from: prior?.orderId ?? null,
        },
      });
    } catch (err) {
      console.warn('[allocate] ALLOCATED event failed (non-fatal)', err);
    }

    return NextResponse.json({
      success: true,
      allocation,
      order_id: order.id,
      order_ref: order.order_id,
      transferred: !!(prior && transfer),
    });
  },
  { permission: 'tech.scan_serial' },
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Pulls the `[id]` URL segment without depending on `params` (which is a
 * Promise in Next 15 and adds awkward typing for `withAuth` handlers).
 */
function extractIdSegment(pathname: string): string {
  // /api/serial-units/{id}/allocate
  const m = /\/api\/serial-units\/([^/]+)\/allocate/.exec(pathname);
  return m ? decodeURIComponent(m[1] || '').trim() : '';
}

interface UnitLite {
  id: number;
  sku: string | null;
}

async function resolveUnit(raw: string): Promise<UnitLite | null> {
  if (/^\d+$/.test(raw)) {
    const r = await pool.query<UnitLite>(
      `SELECT id, sku FROM serial_units WHERE id = $1 LIMIT 1`,
      [Number(raw)],
    );
    if (r.rows[0]) return r.rows[0];
  }
  const fallback = await findByNormalizedSerial(raw);
  if (!fallback) return null;
  return { id: fallback.id, sku: fallback.sku ?? null };
}

interface OrderLite {
  id: number;
  order_id: string | null;
}

async function resolveOrder(input: { orderPk: number | null; orderRef: string | null }): Promise<OrderLite | null> {
  if (input.orderPk != null) {
    const r = await pool.query<OrderLite>(
      `SELECT id, order_id FROM orders WHERE id = $1 LIMIT 1`,
      [input.orderPk],
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (input.orderRef) {
    const r = await pool.query<OrderLite>(
      `SELECT id, order_id FROM orders WHERE order_id = $1 ORDER BY id DESC LIMIT 1`,
      [input.orderRef],
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}
