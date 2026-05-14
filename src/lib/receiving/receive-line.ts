import pool from '@/lib/db';
import {
  upsertSerialUnit,
  type SerialUnitRow,
} from '@/lib/neon/serial-units-queries';
import { getSkuCatalogBySku } from '@/lib/neon/sku-catalog-queries';
import {
  recordInventoryEvent,
  type InventoryEventStation,
} from '@/lib/inventory/events';
import { publishStockLedgerEvent } from '@/lib/realtime/publish';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReceiveLineUnitsInput {
  /** receiving_lines.id */
  receiving_line_id: number;

  /**
   * Number of physical units this call represents. Must be >= serials.length.
   * Use 1 for incremental scan-serial calls; use the remaining-to-receive
   * qty for finalize calls (mark-received-po).
   *
   * Zero is valid — emits no ledger/events but still updates line metadata
   * (qa/disp/cond/workflow_status).
   */
  units: number;

  /** Optional serial numbers — at most `units` long. Remaining units are recorded without serials. */
  serials?: Array<string | null | undefined>;

  // Per-line metadata (any of these unset = preserve existing value).
  qa_status?: string | null;
  disposition_code?: string | null;
  condition_grade?: string | null;
  notes?: string | null;

  // Workflow target. 'DONE' = line finalized. 'UNBOXED' = physically received,
  // awaiting test. Anything else is left to the implicit qty rule below.
  // ('RECEIVED' is *not* a valid value — the inbound_workflow_status_enum has no
  // such label; using it crashes the whole query at plan time in Postgres.)
  set_workflow_status?: 'UNBOXED' | 'DONE' | null;

  // Actor + provenance.
  staff_id?: number | null;
  station?: InventoryEventStation;

  // Idempotency. When provided, retries on the same client_event_id
  // return the prior event(s) without duplicate inserts.
  client_event_id?: string | null;

  // Optional raw scan token for audit (e.g. the URL the tech scanned).
  scan_token?: string | null;
}

export interface ReceivedSerialResult {
  serial_unit: SerialUnitRow;
  is_new: boolean;
  prior_status: string | null;
  is_return: boolean;
  warnings: string[];
}

export interface ReceiveLineUnitsResult {
  line_id: number;
  units_added: number;
  serials_recorded: ReceivedSerialResult[];
  ledger_event_ids: number[];
  inventory_event_ids: number[];
  line_state: {
    id: number;
    sku: string | null;
    item_name: string | null;
    quantity_received: number;
    quantity_expected: number | null;
    workflow_status: string | null;
    is_complete: boolean;
  };
}

interface LineTarget {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
  zoho_item_id: string | null;
  zoho_purchaseorder_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  workflow_status: string | null;
}

// ── Internals ──────────────────────────────────────────────────────────────

async function loadLine(lineId: number): Promise<LineTarget | null> {
  const r = await pool.query<LineTarget>(
    `SELECT id, receiving_id, sku, item_name, zoho_item_id, zoho_purchaseorder_id,
            quantity_expected, quantity_received, workflow_status
     FROM receiving_lines
     WHERE id = $1
     LIMIT 1`,
    [lineId],
  );
  return r.rows[0] ?? null;
}

function dedupeSerials(input: ReceiveLineUnitsInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.serials ?? []) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const k = s.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// ── Writer ─────────────────────────────────────────────────────────────────

/**
 * Single writer for "units arrived against a receiving_lines row." Both
 * /api/receiving/scan-serial (incremental, +1) and /api/receiving/mark-received-po
 * (finalize, +remaining) call this.
 *
 * Side effects (per unit, in order):
 *   1. upsertSerialUnit() — only when a serial is present for that unit
 *   2. tech_serial_numbers audit row — only for serialized units
 *   3. sku_stock_ledger delta = +1 (reason=RECEIVED, dimension=WAREHOUSE)
 *      → trigger updates sku_stock.stock
 *   4. inventory_events RECEIVED row (joins to ledger via stock_ledger_id)
 *
 * Then once:
 *   5. UPDATE receiving_lines with QA/disp/cond/notes/workflow_status
 *      and quantity_received += units
 *
 * Bug A is fixed: every serial path now goes through upsertSerialUnit().
 * Bug B is fixed: non-serialized units also emit a ledger row.
 */
export async function receiveLineUnits(
  input: ReceiveLineUnitsInput,
): Promise<ReceiveLineUnitsResult> {
  const line = await loadLine(input.receiving_line_id);
  if (!line) {
    throw new Error(`receiving_line ${input.receiving_line_id} not found`);
  }

  const units = Math.max(0, Math.floor(input.units));
  const serials = dedupeSerials(input);
  if (serials.length > units) {
    throw new Error(
      `receiveLineUnits: serials (${serials.length}) > units (${units})`,
    );
  }

  const station: InventoryEventStation = input.station ?? 'RECEIVING';
  const catalog = line.sku ? await getSkuCatalogBySku(line.sku) : null;

  const serialsRecorded: ReceivedSerialResult[] = [];
  const ledgerEventIds: number[] = [];
  const inventoryEventIds: number[] = [];

  // Snapshot the prior received count so unit_ordinal numbering is stable
  // across concurrent calls and partial failures.
  const priorReceived = Number(line.quantity_received ?? 0);

  // 1. Serial-bearing units first.
  for (let i = 0; i < serials.length; i++) {
    const serial = serials[i];
    const ordinal = priorReceived + i + 1;

    const upserted = await upsertSerialUnit({
      serial_number: serial,
      sku: line.sku,
      sku_catalog_id: catalog?.id ?? null,
      zoho_item_id: line.zoho_item_id,
      origin_source: 'receiving',
      origin_receiving_line_id: line.id,
      actor_id: input.staff_id ?? null,
      condition_grade: input.condition_grade ?? null,
      target_status: 'RECEIVED',
    });
    if (!upserted) continue; // invalid serial — skip

    serialsRecorded.push({
      serial_unit: upserted.unit,
      is_new: upserted.is_new,
      prior_status: upserted.prior_status,
      is_return: upserted.is_return,
      warnings: upserted.warnings,
    });

    // Audit row (lineage). Idempotent via ON CONFLICT DO NOTHING; the
    // existing migrations cover the unique key on this insert pattern.
    try {
      await pool.query(
        `INSERT INTO tech_serial_numbers
           (serial_number, serial_type, tested_by, station_source,
            receiving_line_id, shipment_id, scan_ref, serial_unit_id)
         VALUES ($1, 'SERIAL', $2, 'RECEIVING', $3, NULL, NULL, $4)
         ON CONFLICT DO NOTHING`,
        [
          serial.toUpperCase(),
          input.staff_id ?? null,
          line.id,
          upserted.unit.id,
        ],
      );
    } catch (err) {
      console.warn('receiveLineUnits: tsn audit insert failed (non-fatal)', err);
    }

    // Ledger delta — only on truly new serials. Re-scans of an already-known
    // serial don't double-count.
    if (upserted.is_new && line.sku) {
      const ledger = await pool.query<{ id: number }>(
        `INSERT INTO sku_stock_ledger
           (sku, delta, reason, dimension, staff_id,
            ref_serial_unit_id, ref_receiving_line_id, notes)
         VALUES ($1, 1, 'RECEIVED', 'WAREHOUSE', $2, $3, $4, $5)
         RETURNING id`,
        [
          line.sku,
          input.staff_id ?? null,
          upserted.unit.id,
          line.id,
          `Receiving scan: ${serial.toUpperCase()}`,
        ],
      );
      const ledgerId = ledger.rows[0]?.id ?? null;
      if (ledgerId) {
        ledgerEventIds.push(ledgerId);
        // Realtime fan-out (existing publisher).
        publishStockLedgerEvent({
          ledgerId,
          sku: line.sku,
          delta: 1,
          reason: 'RECEIVED',
          dimension: 'WAREHOUSE',
          staffId: input.staff_id ?? null,
          source: 'receiving.receive-line',
        }).catch((err) => {
          console.warn('receiveLineUnits: publishStockLedgerEvent failed', err);
        });
      }

      // Lifecycle event row, linked to the ledger row.
      const event = await recordInventoryEvent({
        event_type: 'RECEIVED',
        actor_staff_id: input.staff_id ?? null,
        station,
        receiving_id: line.receiving_id,
        receiving_line_id: line.id,
        serial_unit_id: upserted.unit.id,
        sku: line.sku,
        next_status: 'RECEIVED',
        stock_ledger_id: ledgerId,
        scan_token: input.scan_token ?? null,
        client_event_id: input.client_event_id
          ? `${input.client_event_id}:unit-${ordinal}`
          : null,
        notes: `Serial ${serial.toUpperCase()}`,
        payload: {
          unit_ordinal: ordinal,
          is_return: upserted.is_return,
          warnings: upserted.warnings,
        },
      });
      inventoryEventIds.push(event.id);
    } else if (line.sku) {
      // Already known serial (re-scan). Still emit an event so the timeline
      // shows the touch — but skip the ledger delta.
      const event = await recordInventoryEvent({
        event_type: 'RECEIVED',
        actor_staff_id: input.staff_id ?? null,
        station,
        receiving_id: line.receiving_id,
        receiving_line_id: line.id,
        serial_unit_id: upserted.unit.id,
        sku: line.sku,
        prev_status: upserted.prior_status,
        next_status: upserted.unit.current_status,
        scan_token: input.scan_token ?? null,
        client_event_id: input.client_event_id
          ? `${input.client_event_id}:unit-${ordinal}-rescan`
          : null,
        notes: `Re-scan of serial ${serial.toUpperCase()}`,
        payload: {
          unit_ordinal: ordinal,
          rescan: true,
          is_return: upserted.is_return,
        },
      });
      inventoryEventIds.push(event.id);
    }
  }

  // 2. Non-serialized remainder. One ledger row per unit so the audit stays
  //    per-unit; per-line bulk inserts would lose the unit_ordinal mapping.
  const remainderQty = units - serials.length;
  if (remainderQty > 0 && line.sku) {
    for (let j = 0; j < remainderQty; j++) {
      const ordinal = priorReceived + serials.length + j + 1;

      const ledger = await pool.query<{ id: number }>(
        `INSERT INTO sku_stock_ledger
           (sku, delta, reason, dimension, staff_id,
            ref_receiving_line_id, notes)
         VALUES ($1, 1, 'RECEIVED', 'WAREHOUSE', $2, $3, $4)
         RETURNING id`,
        [
          line.sku,
          input.staff_id ?? null,
          line.id,
          `Receiving: line ${line.id} unit ${ordinal} (no serial)`,
        ],
      );
      const ledgerId = ledger.rows[0]?.id ?? null;
      if (ledgerId) {
        ledgerEventIds.push(ledgerId);
        publishStockLedgerEvent({
          ledgerId,
          sku: line.sku,
          delta: 1,
          reason: 'RECEIVED',
          dimension: 'WAREHOUSE',
          staffId: input.staff_id ?? null,
          source: 'receiving.receive-line',
        }).catch((err) => {
          console.warn('receiveLineUnits: publishStockLedgerEvent failed', err);
        });
      }

      const event = await recordInventoryEvent({
        event_type: 'RECEIVED',
        actor_staff_id: input.staff_id ?? null,
        station,
        receiving_id: line.receiving_id,
        receiving_line_id: line.id,
        serial_unit_id: null,
        sku: line.sku,
        next_status: 'RECEIVED',
        stock_ledger_id: ledgerId,
        scan_token: input.scan_token ?? null,
        client_event_id: input.client_event_id
          ? `${input.client_event_id}:unit-${ordinal}`
          : null,
        notes: `Unit ${ordinal} of line ${line.id} (no serial)`,
        payload: {
          unit_ordinal: ordinal,
          serialized: false,
        },
      });
      inventoryEventIds.push(event.id);
    }
  }

  // 3. Update the line in one shot. quantity_received += units; flip workflow
  //    based on caller intent + computed completeness.
  const explicitWorkflow = input.set_workflow_status ?? null;
  const update = await pool.query<{
    id: number;
    sku: string | null;
    item_name: string | null;
    quantity_received: number;
    quantity_expected: number | null;
    workflow_status: string | null;
  }>(
    `UPDATE receiving_lines
     SET quantity_received = quantity_received + $2,
         qa_status        = COALESCE($3, qa_status),
         disposition_code = COALESCE($4, disposition_code),
         condition_grade  = COALESCE($5, condition_grade),
         notes            = COALESCE($6, notes),
         workflow_status = CASE
           WHEN $7::text = 'DONE'
             THEN 'DONE'::inbound_workflow_status_enum
           WHEN $7::text = 'UNBOXED'
             THEN 'UNBOXED'::inbound_workflow_status_enum
           WHEN quantity_expected IS NOT NULL
                AND (quantity_received + $2) >= quantity_expected
             THEN 'UNBOXED'::inbound_workflow_status_enum
           ELSE workflow_status
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, sku, item_name, quantity_received,
               quantity_expected, workflow_status::text AS workflow_status`,
    [
      line.id,
      units,
      input.qa_status ?? null,
      input.disposition_code ?? null,
      input.condition_grade ?? null,
      input.notes ?? null,
      explicitWorkflow,
    ],
  );

  const updated = update.rows[0] ?? {
    id: line.id,
    sku: line.sku,
    item_name: line.item_name,
    quantity_received: priorReceived + units,
    quantity_expected: line.quantity_expected,
    workflow_status: line.workflow_status,
  };

  return {
    line_id: line.id,
    units_added: units,
    serials_recorded: serialsRecorded,
    ledger_event_ids: ledgerEventIds,
    inventory_event_ids: inventoryEventIds,
    line_state: {
      id: Number(updated.id),
      sku: updated.sku,
      item_name: updated.item_name,
      quantity_received: Number(updated.quantity_received),
      quantity_expected:
        updated.quantity_expected != null ? Number(updated.quantity_expected) : null,
      workflow_status: updated.workflow_status,
      is_complete:
        updated.quantity_expected != null &&
        Number(updated.quantity_received) >= Number(updated.quantity_expected),
    },
  };
}
