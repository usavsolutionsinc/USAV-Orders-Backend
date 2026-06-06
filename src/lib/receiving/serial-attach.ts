import pool from '@/lib/db';
import {
  normalizeSerial,
  upsertSerialUnit,
  type SerialUnitRow,
} from '@/lib/neon/serial-units-queries';
import { getSkuCatalogBySku } from '@/lib/neon/sku-catalog-queries';
import {
  recordInventoryEvent,
  type InventoryEventStation,
} from '@/lib/inventory/events';
import { attachTechSerial } from '@/lib/inventory/tech-serial';

/**
 * Serial numbers as a SIDECAR. A `serial_units` row IS the item identity
 * (serial + condition + status + location) and is shared across
 * receiving/testing/shipping/inventory. Attaching or detaching a serial on a
 * receiving line is pure metadata CRUD:
 *
 *   - NO `sku_stock_ledger` delta
 *   - NO `receiving_lines.quantity_received` change
 *   - NO workflow_status advance / workflow NOTE
 *   - NO cap — a line may carry unlimited serials (a unit can ship several
 *     serials: a pair, multi-component, part serials, etc.)
 *
 * Stock and received-quantity are owned exclusively by the PO line item via
 * the Receive action (`receiveLineUnits` in {@link ./receive-line}). These two
 * concerns are deliberately independent: scanning serials never moves stock.
 */

interface SerialLineTarget {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
  zoho_item_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  workflow_status: string | null;
}

function lineState(line: SerialLineTarget) {
  const received = Number(line.quantity_received ?? 0);
  const expected =
    line.quantity_expected != null ? Number(line.quantity_expected) : null;
  return {
    id: line.id,
    sku: line.sku,
    item_name: line.item_name,
    quantity_received: received,
    quantity_expected: expected,
    workflow_status: line.workflow_status,
    is_complete: expected != null && received >= expected,
  };
}

async function loadLine(
  client: Pick<import('pg').PoolClient, 'query'>,
  lineId: number,
): Promise<SerialLineTarget | null> {
  const r = await client.query<SerialLineTarget>(
    `SELECT id, receiving_id, sku, item_name, zoho_item_id,
            quantity_expected, quantity_received, workflow_status::text AS workflow_status
     FROM receiving_lines
     WHERE id = $1
     LIMIT 1`,
    [lineId],
  );
  return r.rows[0] ?? null;
}

export interface AttachSerialInput {
  receiving_line_id: number;
  serial_number: string;
  condition_grade?: string | null;
  staff_id?: number | null;
  station?: InventoryEventStation;
  client_event_id?: string | null;
  scan_token?: string | null;
}

export interface AttachSerialResult {
  line_id: number;
  serial_unit: SerialUnitRow;
  is_new: boolean;
  prior_status: string | null;
  is_return: boolean;
  warnings: string[];
  /** True when the same serial was already attached to this line — friendly no-op. */
  already_attached: boolean;
  inventory_event_id: number | null;
  line_state: ReturnType<typeof lineState>;
}

/**
 * Attach a serial to a receiving line. Upserts the `serial_units` row, writes a
 * `tech_serial_numbers` lineage row, and records a RECEIVED inventory_event for
 * the audit trail. Never touches quantity or the stock ledger. Idempotent: a
 * re-scan of a serial already on this line returns `already_attached: true`.
 */
export async function attachSerialToLine(
  input: AttachSerialInput,
): Promise<AttachSerialResult | null> {
  const normalized = normalizeSerial(input.serial_number);
  if (!normalized) return null; // invalid serial

  const station: InventoryEventStation = input.station ?? 'RECEIVING';
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const line = await loadLine(client, input.receiving_line_id);
    if (!line) {
      await client.query('ROLLBACK');
      throw new Error(`receiving_line ${input.receiving_line_id} not found`);
    }

    // Idempotent re-scan: same serial already on this line → friendly no-op.
    const existing = await client.query<{ id: number }>(
      `SELECT id FROM serial_units
        WHERE normalized_serial = $1
          AND origin_receiving_line_id = $2
        LIMIT 1`,
      [normalized, line.id],
    );
    if (existing.rows[0]) {
      const full = await client.query<SerialUnitRow>(
        `SELECT * FROM serial_units WHERE id = $1 LIMIT 1`,
        [existing.rows[0].id],
      );
      await client.query('COMMIT');
      committed = true;
      return {
        line_id: line.id,
        serial_unit: full.rows[0],
        is_new: false,
        prior_status: full.rows[0]?.current_status ?? null,
        is_return: false,
        warnings: [],
        already_attached: true,
        inventory_event_id: null,
        line_state: lineState(line),
      };
    }

    const catalog = line.sku ? await getSkuCatalogBySku(line.sku) : null;

    const upserted = await upsertSerialUnit(
      {
        serial_number: input.serial_number,
        sku: line.sku,
        sku_catalog_id: catalog?.id ?? null,
        zoho_item_id: line.zoho_item_id,
        origin_source: 'receiving',
        origin_receiving_line_id: line.id,
        actor_id: input.staff_id ?? null,
        condition_grade: input.condition_grade ?? null,
        target_status: 'RECEIVED',
      },
      { dbClient: client },
    );
    if (!upserted) {
      await client.query('ROLLBACK');
      return null; // invalid serial
    }

    // Lineage audit row. Idempotent via ON CONFLICT DO NOTHING. Shares the
    // transaction client so it commits/rolls back atomically with the upsert.
    try {
      await attachTechSerial(
        {
          serialNumber: input.serial_number,
          serialUnitId: upserted.unit.id,
          stationSource: 'RECEIVING',
          testedBy: input.staff_id ?? null,
          receivingLineId: line.id,
        },
        client,
      );
    } catch (err) {
      console.warn('attachSerialToLine: tsn audit insert failed (non-fatal)', err);
    }

    // Audit-only lifecycle event. stock_ledger_id is deliberately null — a
    // serial attach is not a stock movement.
    const event = await recordInventoryEvent(
      {
        event_type: 'RECEIVED',
        actor_staff_id: input.staff_id ?? null,
        station,
        receiving_id: line.receiving_id,
        receiving_line_id: line.id,
        serial_unit_id: upserted.unit.id,
        sku: line.sku,
        next_status: 'RECEIVED',
        stock_ledger_id: null,
        scan_token: input.scan_token ?? null,
        client_event_id: input.client_event_id
          ? `${input.client_event_id}:attach`
          : null,
        notes: `Serial ${input.serial_number.toUpperCase()}`,
        payload: {
          serial_attach: true,
          is_return: upserted.is_return,
          warnings: upserted.warnings,
        },
      },
      client,
    );

    await client.query('COMMIT');
    committed = true;

    return {
      line_id: line.id,
      serial_unit: upserted.unit,
      is_new: upserted.is_new,
      prior_status: upserted.prior_status,
      is_return: upserted.is_return,
      warnings: upserted.warnings,
      already_attached: false,
      inventory_event_id: event.id,
      line_state: lineState(line),
    };
  } catch (err) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection may already be in error state */
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface DetachSerialInput {
  receiving_line_id: number;
  serial_unit_id?: number | null;
  serial_number?: string | null;
  staff_id?: number | null;
  station?: InventoryEventStation;
}

export interface DetachSerialResult {
  removed: boolean;
  removed_serial_unit_id: number | null;
  removed_serial_number: string | null;
  line_state: ReturnType<typeof lineState> | null;
}

/**
 * Detach (delete) a serial from a receiving line. Scoped to
 * `origin_receiving_line_id` so a unit that has already moved past receiving is
 * never clobbered. Never decrements quantity or writes a reversing ledger row.
 */
export async function detachSerialFromLine(
  input: DetachSerialInput,
): Promise<DetachSerialResult> {
  const serialUnitId =
    input.serial_unit_id != null && Number.isFinite(input.serial_unit_id)
      ? Math.floor(input.serial_unit_id)
      : null;
  const serialNumber = (input.serial_number ?? '').trim() || null;
  if (!serialUnitId && !serialNumber) {
    throw new Error('detachSerialFromLine: serial_unit_id or serial_number is required');
  }

  const station: InventoryEventStation = input.station ?? 'RECEIVING';
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const lookup = await client.query<{
      id: number;
      sku: string | null;
      serial_number: string;
    }>(
      serialUnitId
        ? `SELECT id, sku, serial_number
             FROM serial_units
            WHERE id = $1 AND origin_receiving_line_id = $2
            LIMIT 1`
        : `SELECT id, sku, serial_number
             FROM serial_units
            WHERE normalized_serial = upper(trim($1))
              AND origin_receiving_line_id = $2
            LIMIT 1`,
      serialUnitId
        ? [serialUnitId, input.receiving_line_id]
        : [serialNumber, input.receiving_line_id],
    );

    const unit = lookup.rows[0];
    if (!unit) {
      await client.query('ROLLBACK');
      committed = true; // nothing to roll back further
      const line = await loadLine(pool, input.receiving_line_id);
      return {
        removed: false,
        removed_serial_unit_id: null,
        removed_serial_number: null,
        line_state: line ? lineState(line) : null,
      };
    }

    // FK references in tech_serial_numbers / sku_stock_ledger are ON DELETE SET
    // NULL so historical lineage is preserved.
    await client.query(`DELETE FROM serial_units WHERE id = $1`, [unit.id]);

    // Lineage NOTE so the timeline records the removal. No qty / ledger change.
    try {
      await recordInventoryEvent(
        {
          event_type: 'NOTE',
          actor_staff_id: input.staff_id ?? null,
          station,
          receiving_line_id: input.receiving_line_id,
          sku: unit.sku,
          notes: `Serial ${unit.serial_number.toUpperCase()} removed`,
          payload: { serial_detach: true },
        },
        client,
      );
    } catch (err) {
      console.warn('detachSerialFromLine: note event failed (non-fatal)', err);
    }

    await client.query('COMMIT');
    committed = true;

    const line = await loadLine(pool, input.receiving_line_id);
    return {
      removed: true,
      removed_serial_unit_id: unit.id,
      removed_serial_number: unit.serial_number,
      line_state: line ? lineState(line) : null,
    };
  } catch (err) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    throw err;
  } finally {
    client.release();
  }
}
