import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import {
  normalizeSerial,
  upsertSerialUnit,
  type SerialUnitRow,
} from '@/lib/neon/serial-units-queries';
import { resolveSkuCatalogId } from '@/lib/neon/sku-catalog-queries';
import {
  recordInventoryEvent,
  type InventoryEventStation,
} from '@/lib/inventory/events';
import { attachTechSerial } from '@/lib/inventory/tech-serial';
import { workflowStageLabel } from '@/lib/receiving/workflow-stages';
import { publishStockLedgerEvent } from '@/lib/realtime/publish';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReceiveLineUnitsInput {
  /** Owning tenant (from ctx.organizationId) — required so the realtime stock
   *  ledger event is published on this org's channel. */
  organizationId: string;

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
  // awaiting test. 'MATCHED' = scanned / staged (UI label "SCANNED") — e.g. awaiting Zoho receive.
  // Anything else is left to the implicit qty rule below.
  // ('RECEIVED' is *not* a valid value — the inbound_workflow_status_enum has no
  // such label; using it crashes the whole query at plan time in Postgres.)
  set_workflow_status?: 'UNBOXED' | 'DONE' | 'MATCHED' | null;

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
  /**
   * True when the incoming scan was a no-op — the same serial is already
   * recorded against this line. Caller should treat the response as success
   * and surface an "already received" message rather than an error.
   */
  already_received?: boolean;
  /**
   * True when quantity_expected is set and quantity_received already met it:
   * this call did not bump qty / ledger — UI should toast "already received"
   * without pretending the line progressed.
   */
  already_complete?: boolean;
  /**
   * True when one or more serials were logged AFTER quantity_received had
   * already met quantity_expected. The serial is still recorded in both
   * `serial_units` and `tech_serial_numbers` so a tech can keep scanning
   * extras for a PO line without the count or stock ledger changing.
   * Receiving / Testing UIs use this to render a "supplemental" toast.
   */
  supplemental?: boolean;
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

/**
 * Load the line under a row-level lock inside the provided transaction. Used
 * by receiveLineUnits to serialize concurrent scans so quantity_received and
 * serial writes stay consistent. The lock is released on COMMIT/ROLLBACK.
 */
async function loadLineForUpdate(
  client: import('pg').PoolClient,
  lineId: number,
): Promise<LineTarget | null> {
  const r = await client.query<LineTarget>(
    `SELECT id, receiving_id, sku, item_name, zoho_item_id, zoho_purchaseorder_id,
            quantity_expected, quantity_received, workflow_status
     FROM receiving_lines
     WHERE id = $1
     FOR UPDATE`,
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
 *      → trigger updates sku_stock.stock        — SKIPPED for supplemental
 *   4. inventory_events RECEIVED row (joins to ledger via stock_ledger_id)
 *
 * Then once:
 *   5. UPDATE receiving_lines with QA/disp/cond/notes/workflow_status
 *      and quantity_received += effectiveUnits  (effectiveUnits=0 for supplemental)
 *
 * Supplemental serials: PO lines are NOT hard-capped at quantity_expected.
 * A tech can keep scanning extras for a line; each extra still lands in
 * serial_units + tech_serial_numbers (so /testing chip lists + master
 * registry stay honest), but the sku_stock_ledger and the line's qty
 * counter both stop at expected so received-vs-actual ratios don't drift.
 * Result.supplemental=true flags the call so the UI can toast accordingly.
 *
 * Bug A is fixed: every serial path now goes through upsertSerialUnit().
 * Bug B is fixed: non-serialized units also emit a ledger row.
 *
 * upsertSerialUnit() MUST run on this same PoolClient (`{ dbClient: client }`).
 * A second pooled connection would block on the receiving_lines row locked by
 * FOR UPDATE (FK check on origin_receiving_line_id) until Neon times out.
 */
export async function receiveLineUnits(
  input: ReceiveLineUnitsInput,
): Promise<ReceiveLineUnitsResult> {
  // withTenantTransaction owns BEGIN / SET LOCAL app.current_org / COMMIT /
  // ROLLBACK / release. One transaction means the SELECT ... FOR UPDATE on
  // receiving_lines holds for the lifetime of the callback, so concurrent
  // scan-serial requests on the same line block on this lock and reads/writes
  // serialize correctly. It also sets the org GUC, so every inventory_events /
  // sku_stock_ledger insert inside auto-stamps organization_id (the column
  // default reads current_setting('app.current_org')).
  return withTenantTransaction(input.organizationId, async (client) => {
    const line = await loadLineForUpdate(client, input.receiving_line_id);
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

    const priorReceivedForGuard = Number(line.quantity_received ?? 0);
    const expectedForGuard =
      line.quantity_expected != null ? Number(line.quantity_expected) : null;

    // Idempotent re-scan: if the caller sends exactly one serial and that SN is
    // already on this line, return success without mutating qty. Same-barcode or
    // retry UX should stay friendly. Only triggers when receiving would exceed
    // capacity — otherwise the serial path below upserts and bumps the counter.
    if (
      units === 1 &&
      serials.length === 1 &&
      expectedForGuard != null &&
      priorReceivedForGuard + units > expectedForGuard
    ) {
      const normalized = normalizeSerial(serials[0]);
      if (normalized) {
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM serial_units
            WHERE normalized_serial = $1
              AND origin_receiving_line_id = $2
            LIMIT 1`,
          [normalized, line.id],
        );
        if (existing.rows[0]) {
          return {
            line_id: line.id,
            units_added: 0,
            serials_recorded: [],
            ledger_event_ids: [],
            inventory_event_ids: [],
            already_received: true,
            line_state: {
              id: line.id,
              sku: line.sku,
              item_name: line.item_name,
              quantity_received: priorReceivedForGuard,
              quantity_expected: expectedForGuard,
              workflow_status: line.workflow_status,
              is_complete: priorReceivedForGuard >= expectedForGuard,
            },
          };
        }
      }
    }

    // Over-cap supplemental scan. PO lines are never hard-capped at the
    // expected qty — a tech can keep scanning extras and they still land in
    // serial_units + tech_serial_numbers. The qty counter and the
    // sku_stock_ledger DO stop at expected so receiving-vs-actual numbers
    // stay honest; the audit + chip strip do NOT. `supplemental: true`
    // flows up to the UI so it can toast "Extra serial logged" instead of
    // a misleading "fully received" message.
    const isOverCap =
      units > 0 &&
      expectedForGuard != null &&
      priorReceivedForGuard + units > expectedForGuard;

    const station: InventoryEventStation = input.station ?? 'RECEIVING';
    // Title-guarded: a receiving line's SKU is a Zoho SKU, which collides with
    // the marketplace catalog numbering. Pass the clean Zoho item name (items
    // mirror; canonical SoT) so scanned units never get bound to a
    // coincidentally-same-numbered marketplace product (e.g. Zoho 00143
    // Soundbar vs Ecwid 143 UB-20 Wall Mount). Fall back to the line's
    // listing-style name only when there's no Zoho item to key on.
    let guardTitle = line.item_name;
    if (line.zoho_item_id) {
      const zi = await pool.query<{ name: string | null }>(
        `SELECT name FROM items WHERE zoho_item_id = $1 AND status = 'active' LIMIT 1`,
        [line.zoho_item_id],
      );
      guardTitle = zi.rows[0]?.name?.trim() || line.item_name;
    }
    const catalogId = line.sku
      ? await resolveSkuCatalogId(line.sku, line.zoho_item_id, guardTitle)
      : null;

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

    const upserted = await upsertSerialUnit(
      {
        serial_number: serial,
        sku: line.sku,
        sku_catalog_id: catalogId,
        zoho_item_id: line.zoho_item_id,
        origin_source: 'receiving',
        origin_receiving_line_id: line.id,
        actor_id: input.staff_id ?? null,
        condition_grade: input.condition_grade ?? null,
        target_status: 'RECEIVED',
      },
      { dbClient: client },
      input.organizationId,
    );
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
    // Uses the transaction client so it (a) shares the row lock + rollback
    // semantics and (b) doesn't compete for a fresh connection out of the pool
    // (poolMax=3 in prod — pool.query here under concurrent load was the source
    // of "Query read timeout" errors on mark-received-po).
    try {
      await attachTechSerial(
        {
          serialNumber: serial,
          serialUnitId: upserted.unit.id,
          stationSource: 'RECEIVING',
          testedBy: input.staff_id ?? null,
          receivingLineId: line.id,
        },
        client,
      );
    } catch (err) {
      console.warn('receiveLineUnits: tsn audit insert failed (non-fatal)', err);
    }

    // Ledger delta — only on truly new serials AND only when this scan is
    // still counted against the PO line's expected qty. Re-scans of an
    // already-known serial don't double-count, and over-cap supplemental
    // scans still record the serial but never bump the stock ledger (so
    // received-vs-actual ratios stay honest).
    if (upserted.is_new && line.sku && !isOverCap) {
      const ledger = await client.query<{ id: number }>(
        `INSERT INTO sku_stock_ledger
           (organization_id, sku, delta, reason, dimension, staff_id,
            ref_serial_unit_id, ref_receiving_line_id, notes)
         VALUES ($1, $2, 1, 'RECEIVED', 'WAREHOUSE', $3, $4, $5, $6)
         RETURNING id`,
        [
          input.organizationId,
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
          organizationId: input.organizationId,
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

      // Lifecycle event row, linked to the ledger row. Passes `client` so the
      // insert shares the transaction (atomic with the line update) and doesn't
      // grab a second pool connection — see comment above the tech_serial
      // insert.
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
      }, client, input.organizationId);
      inventoryEventIds.push(event.id);
    } else if (upserted.is_new && line.sku && isOverCap) {
      // Supplemental serial logged after the line was already at expected
      // qty. Skip the ledger delta (no stock change), but still emit a
      // RECEIVED inventory event with `supplemental: true` so the audit
      // timeline records the touch.
      const event = await recordInventoryEvent({
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
          ? `${input.client_event_id}:unit-${ordinal}-supplemental`
          : null,
        notes: `Serial ${serial.toUpperCase()}`,
        payload: {
          unit_ordinal: ordinal,
          supplemental: true,
          is_return: upserted.is_return,
          warnings: upserted.warnings,
        },
      }, client, input.organizationId);
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
      }, client, input.organizationId);
      inventoryEventIds.push(event.id);
    }
  }

  // 2. Non-serialized remainder. One ledger row per unit so the audit stays
  //    per-unit; per-line bulk inserts would lose the unit_ordinal mapping.
  //    Skipped entirely when the call is over cap — non-serialized units
  //    can't be "supplemental" because there's no serial to keep beyond
  //    the qty; we would just be inflating the ledger.
  const remainderQty = units - serials.length;
  if (remainderQty > 0 && line.sku && !isOverCap) {
    for (let j = 0; j < remainderQty; j++) {
      const ordinal = priorReceived + serials.length + j + 1;

      const ledger = await client.query<{ id: number }>(
        `INSERT INTO sku_stock_ledger
           (organization_id, sku, delta, reason, dimension, staff_id,
            ref_receiving_line_id, notes)
         VALUES ($1, $2, 1, 'RECEIVED', 'WAREHOUSE', $3, $4, $5)
         RETURNING id`,
        [
          input.organizationId,
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
          organizationId: input.organizationId,
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
      }, client, input.organizationId);
      inventoryEventIds.push(event.id);
    }
  }

  // 3. Update the line in one shot — runs on the SAME client as the SELECT
  //    FOR UPDATE so it inherits the row lock. quantity_received += units;
  //    flip workflow based on caller intent + computed completeness.
  //    Over-cap scans pass effectiveUnits=0 so the counter never goes above
  //    quantity_expected even when extras were logged as supplemental.
  const explicitWorkflow = input.set_workflow_status ?? null;
  const effectiveUnits = isOverCap ? 0 : units;
  const update = await client.query<{
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
           WHEN $7::text = 'MATCHED'
             THEN 'MATCHED'::inbound_workflow_status_enum
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
      effectiveUnits,
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
    quantity_received: priorReceived + effectiveUnits,
    quantity_expected: line.quantity_expected,
    workflow_status: line.workflow_status,
  };

  // 4. Workflow-stage transition audit. The per-unit RECEIVED events above
  //    capture stock movement, but the line's workflow_status advance
  //    (EXPECTED → MATCHED / UNBOXED / DONE, whether explicit or auto on
  //    qty-completion) was previously invisible to the audit timeline. Emit one
  //    NOTE event carrying prev/next so the receiving half of the trail shows
  //    stage changes the same way the testing half (status/route.ts) already
  //    does. Fires only on a real change; idempotent via the client_event_id
  //    suffix so retries don't duplicate.
  const prevWorkflow = line.workflow_status ?? null;
  const nextWorkflow = updated.workflow_status ?? null;
  if (nextWorkflow && nextWorkflow !== prevWorkflow) {
    const transition = await recordInventoryEvent({
      event_type: 'NOTE',
      actor_staff_id: input.staff_id ?? null,
      station,
      receiving_id: line.receiving_id,
      receiving_line_id: line.id,
      sku: updated.sku,
      prev_status: prevWorkflow,
      next_status: nextWorkflow,
      scan_token: input.scan_token ?? null,
      client_event_id: input.client_event_id
        ? `${input.client_event_id}:workflow-${nextWorkflow}`
        : null,
      notes: `Stage ${workflowStageLabel(prevWorkflow)} → ${workflowStageLabel(nextWorkflow)}`,
      payload: {
        workflow_transition: true,
        from: prevWorkflow,
        to: nextWorkflow,
      },
    }, client, input.organizationId);
    inventoryEventIds.push(transition.id);
  }

    return {
      line_id: line.id,
      units_added: effectiveUnits,
      serials_recorded: serialsRecorded,
      ledger_event_ids: ledgerEventIds,
      inventory_event_ids: inventoryEventIds,
      // `supplemental` flows up so receivers/testers can show "Extra serial
      // logged" rather than the misleading "already received" message.
      supplemental: isOverCap || undefined,
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
  });
}
