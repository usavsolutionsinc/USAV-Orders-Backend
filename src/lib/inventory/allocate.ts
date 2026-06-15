/**
 * allocate.ts
 * ────────────────────────────────────────────────────────────────────
 * Shared allocation transaction. Both /api/orders/[id]/allocate and
 * the admin bulk-allocate page call this so there's one source of
 * truth for the FIFO selection rule, the per-unit event emission,
 * and the idx_oua_open_unit contention pattern.
 *
 * Caller responsibilities:
 *   - Resolve actorStaffId from the session.
 *   - Decide whether to retry on partial allocation (this helper
 *     returns { allocated, requested, partial } and lets the caller
 *     decide).
 */

import type { PoolClient } from 'pg';
import { transaction } from '@/lib/neon-client';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  pickableSerialUnitsLeftJoin,
  pickableSerialUnitsWhereClause,
} from '@/lib/inventory/pickability';
import { transition } from '@/lib/inventory/state-machine';

const VALID_GRADES = ['BRAND_NEW', 'LIKE_NEW', 'REFURBISHED', 'USED_A', 'USED_B', 'USED_C', 'PARTS'] as const;
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
 *
 * Tenancy: pass `orgId` to run the whole allocation inside a tenant-scoped
 * transaction (`withTenantTransaction`, which sets the `app.current_org` GUC
 * via SET LOCAL) and to add explicit `organization_id` predicates on the order
 * load, the candidate selection, and the allocation INSERT. Omitting `orgId`
 * keeps the legacy raw-pool `transaction` path byte-identical — every existing
 * caller that doesn't yet thread org behaves exactly as before. The shared
 * `transition()` writes inherit the GUC from the wrapping transaction client.
 */
export async function allocateOrder(
  input: AllocateOrderInput,
  orgId?: OrgId,
): Promise<AllocateOrderResult> {
  const run = (client: PoolClient) => allocateOrderInTx(client, input, orgId);
  return orgId
    ? withTenantTransaction<AllocateOrderResult>(orgId, run)
    : transaction<AllocateOrderResult>(run);
}

/**
 * Body of the allocation transaction, shared by the raw-pool and tenant-scoped
 * entry paths. When `orgId` is supplied the reads/writes carry an explicit
 * `organization_id` predicate (defence-in-depth alongside the GUC set by
 * `withTenantTransaction`); when omitted the SQL is exactly the legacy form.
 */
async function allocateOrderInTx(
  client: PoolClient,
  input: AllocateOrderInput,
  orgId?: OrgId,
): Promise<AllocateOrderResult> {
  // 1. Load the order line. Resolve the canonical SKU via sku_catalog_id
  //    when the order has been paired; otherwise fall back to the raw
  //    order.sku string (which usually holds the marketplace platform_sku).
  //
  //    Why: serial_units.sku stores the internal catalog SKU ('00001-BK'),
  //    but orders.sku stores whatever the marketplace sent ('01279-B').
  //    Matching verbatim never hits — sku_platform_ids + the manual
  //    pairing flow at /api/sku-catalog/pair exist precisely to bridge
  //    that gap, and orders.sku_catalog_id is the resolved link.
  const orderQ = await client.query<{
    id: number;
    sku: string | null;
    quantity: string | null;
    condition: string | null;
    sku_catalog_id: number | null;
    canonical_sku: string | null;
  }>(
    // The sku_catalog join is on the integer surrogate PK (sc.id), which is
    // globally unique, so it is safe bare; the org gate lives on orders (o).
    `SELECT o.id, o.sku, o.quantity, o.condition, o.sku_catalog_id, sc.sku AS canonical_sku
       FROM orders o
  LEFT JOIN sku_catalog sc ON sc.id = o.sku_catalog_id
      WHERE o.id = $1
        ${orgId ? 'AND o.organization_id = $2' : ''}
      LIMIT 1`,
    orgId ? [input.orderId, orgId] : [input.orderId],
  );
  const order = orderQ.rows[0];
  if (!order) return { ok: false, status: 404, error: 'order not found' };

  const matchSku = (order.canonical_sku?.trim() || order.sku?.trim() || '').trim();
  if (!matchSku) {
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
  //    The su.sku match is a string key — scope serial_units to the same org
  //    so an identical SKU string in another tenant can never be picked.
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
        ${orgId ? 'AND su.organization_id = $4' : ''}
      ORDER BY su.id ASC
      LIMIT $3
      FOR UPDATE OF su SKIP LOCKED`,
    orgId
      ? [matchSku, input.conditionGrade ?? null, targetQty, orgId]
      : [matchSku, input.conditionGrade ?? null, targetQty],
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
      // Stamp organization_id on the allocation row when org is threaded so the
      // tenant-owned order_unit_allocations table isolates correctly.
      orgId
        ? `INSERT INTO order_unit_allocations (order_id, serial_unit_id, allocated_by_staff_id, state, organization_id)
           VALUES ($1, $2, $3, 'ALLOCATED', $4)
           RETURNING id`
        : `INSERT INTO order_unit_allocations (order_id, serial_unit_id, allocated_by_staff_id, state)
           VALUES ($1, $2, $3, 'ALLOCATED')
           RETURNING id`,
      orgId
        ? [input.orderId, unit.id, input.actorStaffId, orgId]
        : [input.orderId, unit.id, input.actorStaffId],
    );
    const allocationId = allocQ.rows[0]?.id;
    if (allocationId == null) {
      throw new Error(`allocation insert returned no id for unit ${unit.id}`);
    }

    // Guarded STOCKED→ALLOCATED transition + atomic ALLOCATED event, replacing
    // the former raw status UPDATE + manual event INSERT. Candidates were
    // selected STOCKED-only under FOR UPDATE SKIP LOCKED on this same client,
    // so the guard/expectedFrom passes in the normal path; a drift means a
    // concurrent mutation and must abort the allocation we just inserted.
    //
    // transition() is not yet org-parameterized (Phase 1 hasn't reached the
    // state machine); it writes through this same `client`, so when orgId was
    // supplied those writes inherit the SET LOCAL app.current_org GUC from
    // withTenantTransaction. No org arg to pass here yet.
    const perUnitClientEventId = input.clientEventId
      ? `${input.clientEventId}:${unit.id}`
      : null;
    const t = await transition({
      unitId: unit.id,
      to: 'ALLOCATED',
      eventType: 'ALLOCATED',
      actorStaffId: input.actorStaffId,
      station: 'SYSTEM',
      clientEventId: perUnitClientEventId,
      expectedFrom: 'STOCKED',
      payload: {
        source: 'orders.allocate',
        order_id: input.orderId,
        allocation_id: allocationId,
        ordinal: i + 1,
        platform_sku: order.sku,
        sku_catalog_id: order.sku_catalog_id,
      },
    }, client);
    if (!t.ok) {
      throw new Error(`allocate: STOCKED→ALLOCATED failed for unit ${unit.id}: ${t.error}`);
    }
    allocated.push({ unitId: unit.id, allocationId, eventId: t.eventId });
  }

  return {
    ok: true,
    orderId: input.orderId,
    sku: matchSku,
    requested: targetQty,
    allocated: allocated.length,
    partial: allocated.length < targetQty,
    units: allocated,
  };
}
