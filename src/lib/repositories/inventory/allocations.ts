/**
 * order_unit_allocations repository
 * ────────────────────────────────────────────────────────────────────
 * Read helpers plus a minimal allocate()/release() pair. The full
 * allocation flow (FIFO selection by condition grade, multi-line orders,
 * Zoho webhook ingest) lands in Phase 4 of the inventory v2 plan.
 *
 * Concurrency: idx_oua_open_unit is a partial UNIQUE on serial_unit_id
 * WHERE state != 'RELEASED'. Allocating an already-open unit raises a
 * unique-violation; callers should treat that as "someone else got it".
 */
import { db } from '@/lib/drizzle/db';
import { orderUnitAllocations } from '@/lib/drizzle/schema';
import type { OrderUnitAllocation } from '@/lib/drizzle/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';

export type AllocationState = 'ALLOCATED' | 'PICKED' | 'PACKED' | 'SHIPPED' | 'RELEASED';

export interface AllocateInput {
  orderId: number;
  serialUnitId: number;
  allocatedByStaffId?: number | null;
}

/**
 * Insert an ALLOCATED row. Throws if the unit already has an open
 * allocation (caught by idx_oua_open_unit).
 */
export async function allocate(input: AllocateInput): Promise<OrderUnitAllocation> {
  const result = await db
    .insert(orderUnitAllocations)
    .values({
      orderId: input.orderId,
      serialUnitId: input.serialUnitId,
      allocatedByStaffId: input.allocatedByStaffId ?? null,
      state: 'ALLOCATED',
    })
    .returning();
  return result[0];
}

export interface AdvanceStateInput {
  allocationId: number;
  toState: Exclude<AllocationState, 'RELEASED'>;
}

/**
 * Move an allocation forward. Throws on no-op or invalid transition; the
 * caller should validate `fromState` matches expectation first if strict.
 */
export async function advanceState(input: AdvanceStateInput): Promise<OrderUnitAllocation | null> {
  const updated = await db
    .update(orderUnitAllocations)
    .set({ state: input.toState })
    .where(
      and(
        eq(orderUnitAllocations.id, input.allocationId),
        ne(orderUnitAllocations.state, 'RELEASED'),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

export interface ReleaseInput {
  allocationId: number;
  reason: string;
}

/**
 * Close an allocation. Sets state='RELEASED' and stamps released_at /
 * released_reason. Idempotent: re-releasing a released row is a no-op.
 */
export async function release(input: ReleaseInput): Promise<OrderUnitAllocation | null> {
  const updated = await db
    .update(orderUnitAllocations)
    .set({
      state: 'RELEASED',
      releasedAt: sql`NOW()`,
      releasedReason: input.reason,
    })
    .where(
      and(
        eq(orderUnitAllocations.id, input.allocationId),
        ne(orderUnitAllocations.state, 'RELEASED'),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

export async function findOpenAllocationForUnit(serialUnitId: number): Promise<OrderUnitAllocation | null> {
  const rows = await db
    .select()
    .from(orderUnitAllocations)
    .where(
      and(
        eq(orderUnitAllocations.serialUnitId, serialUnitId),
        ne(orderUnitAllocations.state, 'RELEASED'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listAllocationsForOrder(orderId: number): Promise<OrderUnitAllocation[]> {
  return db
    .select()
    .from(orderUnitAllocations)
    .where(eq(orderUnitAllocations.orderId, orderId))
    .orderBy(desc(orderUnitAllocations.allocatedAt));
}
