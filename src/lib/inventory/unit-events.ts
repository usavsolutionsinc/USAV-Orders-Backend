/**
 * unit-events.ts — the transactional unit-lifecycle façade.
 * ────────────────────────────────────────────────────────────────────
 * `recordUnitEvent()` is the single entry point for "a thing happened to a
 * serialized unit": it upserts the `serial_units` master, writes the
 * `tech_serial_numbers` lineage row, optionally moves quantity via
 * `sku_stock_ledger`, and appends the linked `inventory_events` row — all on
 * ONE pg client so it commits or rolls back atomically with the caller's work.
 *
 * Why a PoolClient (not the pool, not Drizzle): `upsertSerialUnit` takes a
 * `FOR UPDATE` lock that the FK checks and ledger insert must see in the same
 * transaction. The Drizzle (`neon-http`) repositories run on a separate
 * stateless connection and cannot join this transaction (see the transport note
 * in `tech-serial.ts`). Callers own the transaction:
 *
 *     await transaction(async (client) => {
 *       await recordUnitEvent({ ... }, client);
 *       // ...other writes in the same txn...
 *     });
 *
 * This is the spine Phase 2 migrates the hot paths onto incrementally; new
 * unit-touching code should use it rather than hand-rolling the four inserts.
 */

import type { PoolClient } from 'pg';
import {
  upsertSerialUnit,
  type SerialOriginSource,
  type SerialStatus,
  type SerialUnitRow,
} from '@/lib/neon/serial-units-queries';
import type { OrgId } from '@/lib/tenancy/constants';
import { attachTechSerial, type TechSerialStationSource } from '@/lib/inventory/tech-serial';
import {
  recordInventoryEvent,
  type InventoryEventType,
  type InventoryEventStation,
} from '@/lib/inventory/events';

export interface UnitEventLedger {
  /** Signed quantity delta; 0 is ignored (no ledger row written). */
  delta: number;
  reason: string;
  dimension?: 'WAREHOUSE' | 'BOXED';
  reasonCodeId?: number | null;
  refOrderId?: number | null;
  refReceivingLineId?: number | null;
  notes?: string | null;
}

export interface RecordUnitEventInput {
  // ── tenant ──
  /** Owning tenant — required so the org-scoped serial_units upsert can stamp it. */
  organizationId: OrgId;

  // ── unit identity (upsert) ──
  serialNumber: string;
  sku?: string | null;
  skuCatalogId?: number | null;
  zohoItemId?: string | null;
  originSource: SerialOriginSource;
  originReceivingLineId?: number | null;
  conditionGrade?: string | null;
  /** Target lifecycle status; defaults from originSource when omitted. */
  targetStatus?: SerialStatus;

  // ── event ──
  eventType: InventoryEventType;
  station?: InventoryEventStation | null;
  actorStaffId?: number | null;
  receivingId?: number | null;
  receivingLineId?: number | null;
  notes?: string | null;
  /** UNIQUE — pass for idempotent retries. */
  clientEventId?: string | null;
  scanToken?: string | null;
  payload?: Record<string, unknown>;

  // ── tech_serial_numbers lineage (optional) ──
  /** Default true. Set false for non-serial events that shouldn't write lineage. */
  writeTechSerial?: boolean;
  techStationSource?: TechSerialStationSource;

  // ── stock movement (optional) ──
  /** Only when the event actually moves quantity. Linked to the event row. */
  ledger?: UnitEventLedger | null;
}

export interface RecordUnitEventResult {
  unit: SerialUnitRow;
  isNew: boolean;
  priorStatus: string | null;
  isReturn: boolean;
  warnings: string[];
  techSerialId: number | null;
  ledgerId: number | null;
  eventId: number | null;
}

/**
 * Atomically upsert a unit + write its lineage/ledger/event rows on the given
 * transaction client. Throws if the serial is invalid (rolls back via the
 * caller's transaction). Idempotent on `clientEventId` at the event layer.
 */
export async function recordUnitEvent(
  input: RecordUnitEventInput,
  client: PoolClient,
): Promise<RecordUnitEventResult> {
  // 1. Upsert the unit master (return-aware status transition, FOR UPDATE lock).
  const upserted = await upsertSerialUnit(
    {
      serial_number: input.serialNumber,
      sku: input.sku ?? null,
      sku_catalog_id: input.skuCatalogId ?? null,
      zoho_item_id: input.zohoItemId ?? null,
      origin_source: input.originSource,
      origin_receiving_line_id: input.originReceivingLineId ?? null,
      actor_id: input.actorStaffId ?? null,
      condition_grade: input.conditionGrade ?? null,
      target_status: input.targetStatus,
    },
    { dbClient: client },
    input.organizationId,
  );
  if (!upserted) throw new Error('recordUnitEvent: invalid serial number');

  const effectiveSku = input.sku ?? upserted.unit.sku ?? null;

  // 2. Lineage row (default on). Shares the client → atomic with the upsert.
  let techSerialId: number | null = null;
  if (input.writeTechSerial !== false) {
    const tsn = await attachTechSerial(
      {
        serialNumber: input.serialNumber,
        serialUnitId: upserted.unit.id,
        stationSource:
          input.techStationSource ?? (input.station === 'RECEIVING' ? 'RECEIVING' : 'TECH'),
        testedBy: input.actorStaffId ?? null,
        receivingLineId: input.receivingLineId ?? null,
      },
      client,
    );
    techSerialId = tsn.id;
  }

  // 3. Optional stock delta — only when the event moves quantity AND we know the SKU.
  let ledgerId: number | null = null;
  if (input.ledger && input.ledger.delta !== 0 && effectiveSku) {
    const led = await client.query<{ id: number }>(
      `INSERT INTO sku_stock_ledger
         (organization_id, sku, delta, reason, dimension, reason_code_id, staff_id,
          ref_serial_unit_id, ref_order_id, ref_receiving_line_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        input.organizationId,
        effectiveSku,
        input.ledger.delta,
        input.ledger.reason,
        input.ledger.dimension ?? 'WAREHOUSE',
        input.ledger.reasonCodeId ?? null,
        input.actorStaffId ?? null,
        upserted.unit.id,
        input.ledger.refOrderId ?? null,
        input.ledger.refReceivingLineId ?? null,
        input.ledger.notes ?? null,
      ],
    );
    ledgerId = led.rows[0]?.id ?? null;
  }

  // 4. Lifecycle event, linked to the ledger row when one was written.
  const event = await recordInventoryEvent(
    {
      event_type: input.eventType,
      actor_staff_id: input.actorStaffId ?? null,
      station: input.station ?? null,
      receiving_id: input.receivingId ?? null,
      receiving_line_id: input.receivingLineId ?? null,
      serial_unit_id: upserted.unit.id,
      sku: effectiveSku,
      prev_status: upserted.prior_status,
      next_status: input.targetStatus ?? upserted.unit.current_status,
      stock_ledger_id: ledgerId,
      scan_token: input.scanToken ?? null,
      client_event_id: input.clientEventId ?? null,
      notes: input.notes ?? null,
      payload: { ...(input.payload ?? {}), is_return: upserted.is_return },
    },
    client,
    input.organizationId,
  );

  return {
    unit: upserted.unit,
    isNew: upserted.is_new,
    priorStatus: upserted.prior_status,
    isReturn: upserted.is_return,
    warnings: upserted.warnings,
    techSerialId,
    ledgerId,
    eventId: event.id,
  };
}
