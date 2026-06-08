/**
 * inventoryEvents repository
 * ────────────────────────────────────────────────────────────────────
 * Append-only lifecycle/audit event log. Every state-changing operation
 * across receiving → tech → pack → ship should emit one row here in the
 * same transaction that mutates the business state.
 *
 * Idempotency: callers SHOULD pass a stable `clientEventId` (UUID v4 from
 * a mobile client, or a deterministic hash from a server-side route). The
 * column is UNIQUE; ON CONFLICT DO NOTHING means a retry returns the
 * original row without creating a duplicate event.
 */
import { db } from '@/lib/drizzle/db';
import { inventoryEvents } from '@/lib/drizzle/schema';
import type { InventoryEvent } from '@/lib/drizzle/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

/**
 * Canonical event_type values. The DB column is TEXT (not enum) for
 * forward-compat; this union narrows the application-facing API.
 */
export type InventoryEventType =
  // 2026-05-13 set
  | 'RECEIVED'
  | 'TEST_START'
  | 'TEST_PASS'
  | 'TEST_FAIL'
  | 'PUTAWAY'
  | 'MOVED'
  | 'PICKED'
  | 'PACKED'
  | 'SHIPPED'
  | 'ADJUSTED'
  | 'RETURNED'
  | 'SCRAPPED'
  | 'LISTED'
  | 'NOTE'
  // Phase 0 additions
  | 'ALLOCATED'
  | 'RELEASED'
  | 'TRIAGED'
  | 'REPAIR_STARTED'
  | 'REPAIR_COMPLETED'
  | 'GRADED'
  | 'LABELED'
  | 'STAGED'
  | 'HELD'
  | 'RELEASED_HOLD';

export type InventoryEventStation = 'RECEIVING' | 'TECH' | 'PACK' | 'SHIP' | 'MOBILE' | 'SYSTEM';

export interface AppendEventInput {
  eventType: InventoryEventType;
  /** UNIQUE — stable id from the client for retry-safety. Strongly recommended. */
  clientEventId?: string | null;
  actorStaffId?: number | null;
  station?: InventoryEventStation | null;
  /** At least one subject (receivingId / receivingLineId / serialUnitId / sku) should be set. */
  receivingId?: number | null;
  receivingLineId?: number | null;
  serialUnitId?: number | null;
  sku?: string | null;
  binId?: number | null;
  prevBinId?: number | null;
  prevStatus?: string | null;
  nextStatus?: string | null;
  stockLedgerId?: number | null;
  scanToken?: string | null;
  notes?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Append an inventory event. If `clientEventId` collides with an existing
 * row, returns that existing row instead of inserting (idempotent retry).
 *
 * Returns `{ event, created }` where `created` distinguishes new inserts
 * from idempotent hits so callers can branch on first-time-vs-replay.
 *
 * TRANSPORT WARNING (relational-reuse plan, Phase 2): this runs on the Drizzle
 * `neon-http` connection, which is stateless and SEPARATE from the pg `pool`.
 * It therefore CANNOT participate in a `pool.connect()` BEGIN/COMMIT
 * transaction — an event written here will commit independently of the
 * caller's pg transaction. Use it only for standalone, single-row event writes
 * (e.g. the test/grade/allocate routes). For any path that must record the
 * event atomically alongside `serial_units` / `sku_stock_ledger` writes, use
 * the pg-client `recordInventoryEvent(input, client)` in `@/lib/inventory/events`.
 */
export async function appendInventoryEvent(
  input: AppendEventInput,
): Promise<{ event: InventoryEvent; created: boolean }> {
  if (input.clientEventId) {
    const existing = await db
      .select()
      .from(inventoryEvents)
      .where(eq(inventoryEvents.clientEventId, input.clientEventId))
      .limit(1);
    if (existing[0]) return { event: existing[0], created: false };
  }

  const inserted = await db
    .insert(inventoryEvents)
    .values({
      eventType: input.eventType,
      clientEventId: input.clientEventId ?? null,
      actorStaffId: input.actorStaffId ?? null,
      station: input.station ?? null,
      receivingId: input.receivingId ?? null,
      receivingLineId: input.receivingLineId ?? null,
      serialUnitId: input.serialUnitId ?? null,
      sku: input.sku ?? null,
      binId: input.binId ?? null,
      prevBinId: input.prevBinId ?? null,
      prevStatus: input.prevStatus ?? null,
      nextStatus: input.nextStatus ?? null,
      stockLedgerId: input.stockLedgerId ?? null,
      scanToken: input.scanToken ?? null,
      notes: input.notes ?? null,
      payload: (input.payload ?? {}) as never,
    })
    .onConflictDoNothing({ target: inventoryEvents.clientEventId })
    .returning();

  if (inserted[0]) return { event: inserted[0], created: true };

  // Conflict path: fetch the row that won the race.
  if (input.clientEventId) {
    const existing = await db
      .select()
      .from(inventoryEvents)
      .where(eq(inventoryEvents.clientEventId, input.clientEventId))
      .limit(1);
    if (existing[0]) return { event: existing[0], created: false };
  }
  throw new Error('appendInventoryEvent: insert returned no row and no clientEventId to look up');
}

export async function listEventsForSerialUnit(serialUnitId: number, limit = 50): Promise<InventoryEvent[]> {
  return db
    .select()
    .from(inventoryEvents)
    .where(eq(inventoryEvents.serialUnitId, serialUnitId))
    .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id))
    .limit(limit);
}

export async function listEventsForSku(sku: string, limit = 100): Promise<InventoryEvent[]> {
  return db
    .select()
    .from(inventoryEvents)
    .where(eq(inventoryEvents.sku, sku))
    .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id))
    .limit(limit);
}

export async function listEventsForReceivingLine(receivingLineId: number, limit = 100): Promise<InventoryEvent[]> {
  return db
    .select()
    .from(inventoryEvents)
    .where(eq(inventoryEvents.receivingLineId, receivingLineId))
    .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id))
    .limit(limit);
}

export interface RecentEventsByTypeOptions {
  sinceHours?: number;
  station?: InventoryEventStation;
  limit?: number;
}

export async function listRecentEventsByType(
  eventType: InventoryEventType,
  opts: RecentEventsByTypeOptions = {},
): Promise<InventoryEvent[]> {
  const sinceHours = opts.sinceHours ?? 24;
  const limit = opts.limit ?? 200;

  const filters = [
    eq(inventoryEvents.eventType, eventType),
    sql`${inventoryEvents.occurredAt} > NOW() - (${sinceHours}::int * INTERVAL '1 hour')`,
  ];
  if (opts.station) filters.push(eq(inventoryEvents.station, opts.station));

  return db
    .select()
    .from(inventoryEvents)
    .where(and(...filters))
    .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id))
    .limit(limit);
}
