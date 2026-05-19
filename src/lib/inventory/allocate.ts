/**
 * allocate.ts
 * ────────────────────────────────────────────────────────────────────
 * Shared allocation transaction. Both /api/orders/[id]/allocate and
 * the admin bulk-allocate page call this so there's one source of
 * truth for the FIFO selection rule, the per-unit event emission,
 * and the idx_oua_open_unit contention pattern.
 *
 * Caller responsibilities:
 *   - Verify the INVENTORY_V2_ALLOCATION feature flag (not done here so
 *     test harnesses can bypass the gate).
 *   - Resolve actorStaffId from the session.
 *   - Decide whether to retry on partial allocation (this helper
 *     returns { allocated, requested, partial } and lets the caller
 *     decide).
 */

import { transaction } from '@/lib/neon-client';
import {
  pickableSerialUnitsLeftJoin,
  pickableSerialUnitsWhereClause,
} from '@/lib/inventory/pickability';

const VALID_GRADES = ['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS'] as const;
export type ConditionGrade = (typeof VALID_GRADES)[number];

export interface AllocateOrderInput {
  orderId: number;
  /** Override orders.quantity. Falls back to that value (or 1) when omitted. */
  quantity?: number;
  /** When set, only STOCKED units with this grade are eligible. */
  conditionGrade?: ConditionGrade | null;
  /** UUID from the caller for retry-safe inventory_events. Per-unit suffixed. */
  clientEventId?: string | null;
  actorStaffId: number | null;
}

export interface AllocateOrderSuccess {
  ok: true;
  orderId: number;
  sku: string;
  requested: number;
  allocated: number;
  partial: boolean;
  units: Array<{ unitId: number; allocationId: number; eventId: number | null }>;
}

export interface AllocateOrderFailure {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
  requested?: number;
  allocated?: number;
}

export type AllocateOrderResult = AllocateOrderSuccess | AllocateOrderFailure;

export function isValidConditionGrade(value: string): value is ConditionGrade {
  return (VALID_GRADES as readonly string[]).includes(value);
}

/**
 * Run the allocation transaction. Idempotent via the per-unit suffixed
 * clientEventId on inventory_events. Returns 409 when no STOCKED units
 * match (caller should retry later or relax the condition filter).
 */
export async function allocateOrder(input: AllocateOrderInput): Promise<AllocateOrderResult> {
  return transaction<AllocateOrderResult>(async (client) => {
    // 1. Load the order line.
    const orderQ = await client.query<{
      id: number;
      sku: string | null;
      quantity: string | null;
      condition: string | null;
    }>(`SELECT id, sku, quantity, condition FROM orders WHERE id = $1 LIMIT 1`, [input.orderId]);
    const order = orderQ.rows[0];
    if (!order) return { ok: false, status: 404, error: 'order not found' };
    if (!order.sku || !order.sku.trim()) {
      return { ok: false, status: 400, error: 'order has no sku — cannot allocate' };
    }

    const qtyOverrideValid = Number.isFinite(input.quantity) && (input.quantity ?? 0) > 0;
    const targetQty = qtyOverrideValid
      ? Math.floor(input.quantity as number)
      : Math.max(1, Math.floor(Number(order.quantity ?? '1') || 1));

    // 2. Select candidate units — pickable, matching SKU, oldest first.
    //    The pickability predicate centralizes the exclusion rules
    //    (status, bin role, cycle-count lock, expiry) — see
    //    src/lib/inventory/pickability.ts. FOR UPDATE SKIP LOCKED so
    //    concurrent allocators get disjoint subsets; idx_oua_open_unit
    //    partial UNIQUE is the final guarantee against double-allocation.
    const pickableWhere = pickableSerialUnitsWhereClause();
    const pickableJoin = pickableSerialUnitsLeftJoin();
    const candidatesQ = await client.query<{
      id: number;
      current_location: string | null;
      condition_grade: string | null;
    }>(
      `SELECT su.id, su.current_location, su.condition_grade::text AS condition_grade
         FROM serial_units su
         ${pickableJoin}
        WHERE ${pickableWhere}
          AND su.sku = $1
          AND ($2::text IS NULL OR su.condition_grade::text = $2)
        ORDER BY su.id ASC
        LIMIT $3
        FOR UPDATE OF su SKIP LOCKED`,
      [order.sku.trim(), input.conditionGrade ?? null, targetQty],
    );
    const candidates = candidatesQ.rows;
    if (candidates.length === 0) {
      return {
        ok: false,
        status: 409,
        error: 'no STOCKED serial_units available for sku',
        requested: targetQty,
        allocated: 0,
      };
    }

    // 3. Per-unit allocation + state flip + event row.
    const allocated: AllocateOrderSuccess['units'] = [];
    for (let i = 0; i < candidates.length; i++) {
      const unit = candidates[i];

      const allocQ = await client.query<{ id: number }>(
        `INSERT INTO order_unit_allocations (order_id, serial_unit_id, allocated_by_staff_id, state)
         VALUES ($1, $2, $3, 'ALLOCATED')
         RETURNING id`,
        [input.orderId, unit.id, input.actorStaffId],
      );
      const allocationId = allocQ.rows[0]?.id;
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

      const perUnitClientEventId = input.clientEventId
        ? `${input.clientEventId}:${unit.id}`
        : null;
      const evQ = await client.query<{ id: number }>(
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
          input.actorStaffId,
          unit.id,
          order.sku,
          perUnitClientEventId,
          JSON.stringify({
            source: 'orders.allocate',
            order_id: input.orderId,
            allocation_id: allocationId,
            ordinal: i + 1,
          }),
        ],
      );
      allocated.push({ unitId: unit.id, allocationId, eventId: evQ.rows[0]?.id ?? null });
    }

    return {
      ok: true,
      orderId: input.orderId,
      sku: order.sku,
      requested: targetQty,
      allocated: allocated.length,
      partial: allocated.length < targetQty,
      units: allocated,
    };
  });
}
