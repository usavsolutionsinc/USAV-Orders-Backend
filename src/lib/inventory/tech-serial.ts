/**
 * tech-serial.ts
 * ────────────────────────────────────────────────────────────────────
 * Canonical writer for `tech_serial_numbers` lineage rows.
 *
 * Before this helper the same INSERT was hand-rolled in (at least) four
 * places — `receiving/serial-attach.ts`, `receiving/receive-line.ts`,
 * `serial-units/[id]/test/route.ts`, and `tech/insertTechSerialForTracking.ts`
 * — each with a slightly different column subset, which is how rows drifted
 * (e.g. some never stamped `serial_unit_id`). One helper, one column list.
 *
 * Transport note (Phase 2 of the relational-reuse plan): this is pg-client
 * based on purpose. The hot inbound/outbound paths run inside
 * `pool.connect()` → BEGIN/COMMIT transactions; the Drizzle (`neon-http`)
 * repositories run on a SEPARATE stateless HTTP connection and therefore
 * CANNOT co-commit with a pg transaction. Any writer that must be atomic with
 * `serial_units` / `sku_stock_ledger` / `inventory_events` belongs here (pass
 * the transaction's `client`), not in the Drizzle repositories.
 */

import pool from '@/lib/db';
import type { PoolClient } from 'pg';

export type TechSerialStationSource = 'RECEIVING' | 'TECH' | (string & {});
export type TechSerialType = 'SERIAL' | 'FNSKU' | (string & {});

export interface AttachTechSerialInput {
  /** Raw serial; the helper upper-cases it to match the table's convention. */
  serialNumber: string;
  /** FK back to the serial_units master. Strongly recommended — its absence is
   *  exactly the drift this helper exists to prevent. */
  serialUnitId?: number | null;
  serialType?: TechSerialType;
  /** Origin station. Table default is 'TECH'; receiving paths pass 'RECEIVING'. */
  stationSource?: TechSerialStationSource;
  testedBy?: number | null;
  receivingLineId?: number | null;
  shipmentId?: number | null;
  scanRef?: string | null;
  notes?: string | null;
  fnsku?: string | null;
  sourceSkuId?: number | null;
  fbaShipmentId?: number | null;
  fbaShipmentItemId?: number | null;
  contextStationActivityLogId?: number | null;
  ordersExceptionId?: number | null;
  fnskuLogId?: number | null;
  /**
   * Tenant scope. `organization_id` is NOT NULL with a session-aware default
   * (`current_setting('app.current_org')` → fallback org), so it is bound ONLY
   * when explicitly provided — omitting it lets the DB default apply, which is
   * how the receiving/tech paths have always worked. Pass it from contexts
   * (e.g. tech tracking) that carry an explicit org and don't set the session GUC.
   */
  organizationId?: string;
}

/**
 * Insert one `tech_serial_numbers` lineage row. Idempotent via
 * `ON CONFLICT DO NOTHING` (the partial unique index
 * `ux_tsn_receiving_line_serial` guards receiving-line re-scans). Returns the
 * new id, or `null` when a conflict swallowed the insert.
 *
 * Pass `executor` to share the caller's open pg transaction; defaults to the
 * pool for standalone writes.
 */
export async function attachTechSerial(
  input: AttachTechSerialInput,
  executor: Pick<PoolClient, 'query'> = pool,
): Promise<{ id: number | null }> {
  // Fixed core columns (stable param positions; tests assert on these).
  const cols = [
    'serial_number', 'serial_type', 'tested_by', 'station_source',
    'receiving_line_id', 'shipment_id', 'scan_ref', 'notes',
    'fnsku', 'source_sku_id', 'fba_shipment_id', 'fba_shipment_item_id',
    'context_station_activity_log_id', 'orders_exception_id', 'serial_unit_id',
  ];
  const vals: unknown[] = [
    input.serialNumber.toUpperCase(),
    input.serialType ?? 'SERIAL',
    input.testedBy ?? null,
    input.stationSource ?? 'TECH',
    input.receivingLineId ?? null,
    input.shipmentId ?? null,
    input.scanRef ?? null,
    input.notes ?? null,
    input.fnsku ?? null,
    input.sourceSkuId ?? null,
    input.fbaShipmentId ?? null,
    input.fbaShipmentItemId ?? null,
    input.contextStationActivityLogId ?? null,
    input.ordersExceptionId ?? null,
    input.serialUnitId ?? null,
  ];
  // fnsku_log_id is plain-nullable — always safe to bind.
  if (input.fnskuLogId !== undefined) {
    cols.push('fnsku_log_id');
    vals.push(input.fnskuLogId ?? null);
  }
  // organization_id is NOT NULL w/ session default — bind ONLY when provided.
  if (input.organizationId !== undefined) {
    cols.push('organization_id');
    vals.push(input.organizationId);
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const result = await executor.query<{ id: number }>(
    `INSERT INTO tech_serial_numbers (${cols.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT DO NOTHING
     RETURNING id`,
    vals,
  );
  return { id: result.rows[0]?.id ?? null };
}
