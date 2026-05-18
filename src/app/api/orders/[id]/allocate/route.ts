import { NextResponse } from 'next/server';
import { transaction } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Allocation } from '@/lib/feature-flags';

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
 * All writes in a single transaction:
 *   1. INSERT order_unit_allocations rows (one per unit, state='ALLOCATED').
 *      idx_oua_open_unit prevents two orders from claiming the same unit.
 *   2. UPDATE serial_units SET current_status='ALLOCATED'.
 *   3. INSERT inventory_events ALLOCATED rows (one per unit, prev='STOCKED').
 *
 * Returns the list of allocated unit ids + a count when partial.
 *
 * Gated by INVENTORY_V2_ALLOCATION; off-flag returns 503.
 * Permission: orders.view (any authenticated operator can drive allocation;
 * tighten to a dedicated permission in a follow-up phase if needed).
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Allocation()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_ALLOCATION flag is OFF', flag: 'INVENTORY_V2_ALLOCATION' },
      { status: 503 },
    );
  }

  // Next 16 passes route params via the URL; parse the [id] segment.
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  // /api/orders/[id]/allocate → ['api','orders','{id}','allocate']
  const idStr = segments[segments.length - 2];
  const orderId = Number(idStr);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const qtyOverride = Number(body?.quantity);
  const qtyOverrideValid = Number.isFinite(qtyOverride) && qtyOverride > 0;
  const conditionGradeInput = String(body?.condition_grade || '').trim().toUpperCase() || null;
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  const validGrades = ['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS'];
  if (conditionGradeInput && !validGrades.includes(conditionGradeInput)) {
    return NextResponse.json(
      { ok: false, error: `condition_grade must be one of ${validGrades.join(', ')}` },
      { status: 400 },
    );
  }

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await transaction(async (client) => {
      // 1. Load the order line.
      const orderQ = await client.query<{ id: number; sku: string | null; quantity: string | null; condition: string | null }>(
        `SELECT id, sku, quantity, condition FROM orders WHERE id = $1 LIMIT 1`,
        [orderId],
      );
      const order = orderQ.rows[0];
      if (!order) return { ok: false as const, status: 404, error: 'order not found' };
      if (!order.sku || !order.sku.trim()) {
        return { ok: false as const, status: 400, error: 'order has no sku — cannot allocate' };
      }

      const targetQty = qtyOverrideValid
        ? Math.floor(qtyOverride)
        : Math.max(1, Math.floor(Number(order.quantity ?? '1') || 1));

      // 2. Select candidate units — STOCKED, matching SKU, oldest first.
      //    Lock for update via FOR UPDATE SKIP LOCKED so concurrent allocators
      //    don't grab the same row. SKIP LOCKED means under contention each
      //    caller gets a non-overlapping subset; idx_oua_open_unit is the
      //    final guarantee.
      const candidatesQ = await client.query<{ id: number; current_location: string | null; condition_grade: string | null }>(
        `SELECT id, current_location, condition_grade::text AS condition_grade
           FROM serial_units
          WHERE current_status = 'STOCKED'::serial_status_enum
            AND sku = $1
            AND ($2::text IS NULL OR condition_grade::text = $2)
          ORDER BY id ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED`,
        [order.sku.trim(), conditionGradeInput, targetQty],
      );
      const candidates = candidatesQ.rows;
      if (candidates.length === 0) {
        return {
          ok: false as const,
          status: 409,
          error: 'no STOCKED serial_units available for sku',
          requested: targetQty,
          allocated: 0,
        };
      }

      // 3. Allocate. Per-unit allocation + state flip + event row.
      const allocatedUnits: Array<{ unitId: number; allocationId: number; eventId: number | null }> = [];
      for (let i = 0; i < candidates.length; i++) {
        const unit = candidates[i];

        const alloc = await client.query<{ id: number }>(
          `INSERT INTO order_unit_allocations (
            order_id, serial_unit_id, allocated_by_staff_id, state
          )
          VALUES ($1, $2, $3, 'ALLOCATED')
          RETURNING id`,
          [orderId, unit.id, actorStaffId],
        );
        const allocationId = alloc.rows[0]?.id;
        if (allocationId == null) {
          throw new Error(`allocation insert returned no id for unit ${unit.id}`);
        }

        await client.query(
          `UPDATE serial_units
              SET current_status = 'ALLOCATED'::serial_status_enum,
                  updated_at = NOW()
            WHERE id = $1`,
          [unit.id],
        );

        const perUnitClientEventId = clientEventId ? `${clientEventId}:${unit.id}` : null;
        const ev = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
            event_type, actor_staff_id, station,
            serial_unit_id, sku,
            prev_status, next_status,
            client_event_id, payload
          )
          VALUES ('ALLOCATED', $1, 'SYSTEM',
                  $2, $3,
                  'STOCKED', 'ALLOCATED',
                  $4, $5::jsonb)
          ON CONFLICT (client_event_id) DO NOTHING
          RETURNING id`,
          [
            actorStaffId,
            unit.id,
            order.sku,
            perUnitClientEventId,
            JSON.stringify({
              source: 'orders.allocate',
              order_id: orderId,
              allocation_id: allocationId,
              ordinal: i + 1,
            }),
          ],
        );
        allocatedUnits.push({ unitId: unit.id, allocationId, eventId: ev.rows[0]?.id ?? null });
      }

      return {
        ok: true as const,
        orderId,
        sku: order.sku,
        requested: targetQty,
        allocated: allocatedUnits.length,
        units: allocatedUnits,
        partial: allocatedUnits.length < targetQty,
      };
    });

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
