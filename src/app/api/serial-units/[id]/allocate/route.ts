import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { OrderUnitAllocation } from '@/lib/drizzle/schema';
import { findByNormalizedSerial } from '@/lib/neon/serial-units-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';
import { transition } from '@/lib/inventory/state-machine';

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

    const orgId = ctx.organizationId;

    // 1. Resolve the unit.
    const unit = await resolveUnit(idParam, orgId);
    if (!unit) {
      return NextResponse.json({ error: 'Serial unit not found' }, { status: 404 });
    }

    // 2. Resolve the order.
    const order = await resolveOrder({ orderPk, orderRef }, orgId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // 3. Check for an existing open allocation (org-scoped).
    const prior = await findOpenAllocationForUnitOrg(unit.id, orgId);
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
      await releaseAllocationOrg(prior.id, 'REASSIGNED', orgId);
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
        }, undefined, orgId);
      } catch (err) {
        console.warn('[allocate] RELEASED event failed (non-fatal)', err);
      }
    }

    // 5. Allocate. The partial unique index will throw if another writer
    //    raced us — surface that as a 409.
    let allocation: OrderUnitAllocation;
    try {
      allocation = await allocateOrg(
        { orderId: order.id, serialUnitId: unit.id, allocatedByStaffId: ctx.staffId ?? null },
        orgId,
      );
    } catch (err) {
      console.error('[allocate] insert failed', err);
      const msg = err instanceof Error ? err.message : 'Allocation failed';
      const isUniqueViolation = /idx_oua_open_unit|unique/i.test(msg);
      return NextResponse.json(
        { error: isUniqueViolation ? 'Unit was just allocated by another scanner' : msg },
        { status: isUniqueViolation ? 409 : 500 },
      );
    }

    // 6. Flip the unit → ALLOCATED so serial_units.current_status stays in
    //    lockstep with the allocation row (the pick flow then sees a clean
    //    ALLOCATED→PICKED). This also emits the ALLOCATED pairing event
    //    atomically. For a unit already ALLOCATED (reassignment, an identity
    //    transition) or in a non-allocatable state, fall back to recording the
    //    pairing event without a status change.
    const allocatedPayload = {
      allocation_id: allocation.id,
      order_id: order.id,
      order_ref: order.order_id,
      transferred_from: prior?.orderId ?? null,
    };
    let t: Awaited<ReturnType<typeof transition>> | null = null;
    try {
      t = await transition({
        unitId: unit.id,
        to: 'ALLOCATED',
        eventType: 'ALLOCATED',
        actorStaffId: ctx.staffId ?? null,
        station: 'MOBILE',
        clientEventId,
        payload: allocatedPayload,
      }, undefined, orgId);
    } catch (err) {
      // A thrown transition (DB hiccup) must not 500 a request whose allocation
      // already committed — treat it as non-fatal and fall through to the event.
      console.warn('[allocate] unit ALLOCATED transition threw (non-fatal)', err);
    }
    if (!t?.ok) {
      // The unit's status wasn't flipped to ALLOCATED. If the guard rejected
      // because the unit is in a genuinely non-allocatable state (a real
      // from-state that isn't already ALLOCATED — e.g. RECEIVED / IN_TEST),
      // don't leave a dangling ALLOCATED allocation out of sync with the unit:
      // release it and 409. This keeps the invariant the pick flow relies on —
      // "an open ALLOCATED allocation ⇒ the unit is ALLOCATED".
      if (t && !t.ok && t.from && t.from !== 'ALLOCATED') {
        await releaseAllocationOrg(allocation.id, 'NOT_ALLOCATABLE', orgId).catch(() => {});
        return NextResponse.json(
          { error: `Unit is ${t.from} and can't be allocated to an order`, unit_status: t.from },
          { status: 409 },
        );
      }
      // Otherwise (already ALLOCATED / reassignment identity, or a thrown
      // transition): record the pairing event best-effort and keep the allocation.
      try {
        await recordInventoryEvent({
          event_type: 'ALLOCATED',
          actor_staff_id: ctx.staffId ?? null,
          station: 'MOBILE',
          serial_unit_id: unit.id,
          sku: unit.sku,
          client_event_id: clientEventId,
          payload: allocatedPayload,
        }, undefined, orgId);
      } catch (err) {
        console.warn('[allocate] ALLOCATED event failed (non-fatal)', err);
      }
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

async function resolveUnit(raw: string, orgId: OrgId): Promise<UnitLite | null> {
  if (/^\d+$/.test(raw)) {
    const r = await tenantQuery<UnitLite>(
      orgId,
      `SELECT id, sku FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [Number(raw), orgId],
    );
    if (r.rows[0]) return r.rows[0];
  }
  const fallback = await findByNormalizedSerial(raw, orgId);
  if (!fallback) return null;
  return { id: fallback.id, sku: fallback.sku ?? null };
}

interface OrderLite {
  id: number;
  order_id: string | null;
}

async function resolveOrder(input: { orderPk: number | null; orderRef: string | null }, orgId: OrgId): Promise<OrderLite | null> {
  if (input.orderPk != null) {
    const r = await tenantQuery<OrderLite>(
      orgId,
      `SELECT id, order_id FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [input.orderPk, orgId],
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (input.orderRef) {
    const r = await tenantQuery<OrderLite>(
      orgId,
      `SELECT id, order_id FROM orders WHERE order_id = $1 AND organization_id = $2 ORDER BY id DESC LIMIT 1`,
      [input.orderRef, orgId],
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

// ─── order_unit_allocations: org-scoped writers/readers ──────────────────────
// order_unit_allocations is tenant-owned (NOT NULL organization_id with a
// GUC-reading default). The shared allocations repo (allocate/release/
// findOpenAllocationForUnit) runs on the stateless drizzle neon-http connection
// with NO GUC and NO org stamp → the ALLOCATED insert resolves org=NULL → a
// NOT NULL violation, and release()/findOpenAllocationForUnit() are unscoped
// (release keyed only by id). We re-implement them org-scoped here: writes stamp
// organization_id + run under the GUC, reads/updates carry an explicit
// organization_id predicate. Rows are mapped back to the OrderUnitAllocation
// camelCase shape so the JSON response bodies are byte-identical.

interface AllocationRow {
  id: number;
  order_id: number;
  serial_unit_id: number;
  allocated_at: string | Date;
  allocated_by_staff_id: number | null;
  state: string;
  released_at: string | Date | null;
  released_reason: string | null;
}

function mapAllocation(r: AllocationRow): OrderUnitAllocation {
  return {
    id: r.id,
    orderId: r.order_id,
    serialUnitId: r.serial_unit_id,
    allocatedAt: r.allocated_at as never,
    allocatedByStaffId: r.allocated_by_staff_id,
    state: r.state as never,
    releasedAt: r.released_at as never,
    releasedReason: r.released_reason,
  } as OrderUnitAllocation;
}

async function findOpenAllocationForUnitOrg(
  serialUnitId: number,
  orgId: OrgId,
): Promise<OrderUnitAllocation | null> {
  const r = await tenantQuery<AllocationRow>(
    orgId,
    `SELECT * FROM order_unit_allocations
       WHERE serial_unit_id = $1 AND state <> 'RELEASED' AND organization_id = $2
       LIMIT 1`,
    [serialUnitId, orgId],
  );
  return r.rows[0] ? mapAllocation(r.rows[0]) : null;
}

async function allocateOrg(
  input: { orderId: number; serialUnitId: number; allocatedByStaffId: number | null },
  orgId: OrgId,
): Promise<OrderUnitAllocation> {
  return withTenantTransaction(orgId, async (client) => {
    // The partial UNIQUE idx_oua_open_unit still enforces single-open-allocation;
    // a race throws a unique violation the caller surfaces as 409.
    const r = await client.query<AllocationRow>(
      `INSERT INTO order_unit_allocations
         (order_id, serial_unit_id, allocated_by_staff_id, state, organization_id)
       VALUES ($1, $2, $3, 'ALLOCATED', $4)
       RETURNING *`,
      [input.orderId, input.serialUnitId, input.allocatedByStaffId, orgId],
    );
    return mapAllocation(r.rows[0]);
  });
}

async function releaseAllocationOrg(
  allocationId: number,
  reason: string,
  orgId: OrgId,
): Promise<OrderUnitAllocation | null> {
  return withTenantTransaction(orgId, async (client) => {
    const r = await client.query<AllocationRow>(
      `UPDATE order_unit_allocations
          SET state = 'RELEASED', released_at = NOW(), released_reason = $2
        WHERE id = $1 AND state <> 'RELEASED' AND organization_id = $3
        RETURNING *`,
      [allocationId, reason, orgId],
    );
    return r.rows[0] ? mapAllocation(r.rows[0]) : null;
  });
}
