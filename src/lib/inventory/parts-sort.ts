import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { recordInventoryEvent, type InventoryEventStation } from '@/lib/inventory/events';
import {
  findLocationByBarcode,
  findLocationByName,
} from '@/lib/repositories/inventory/locations';

/**
 * Auto-sort to the Parts bin.
 *
 * When a serial unit's condition is set to PARTS ("For Parts") it does not need
 * testing or a claim — it is sorted straight into a single Parts bin in the
 * Technical Room. Parts are sellable AND repair stock, so the bin is PICKABLE
 * (RESERVE role) and the unit lands in normal sellable stock (STOCKED).
 *
 * This is metadata + a location move; it never touches the stock ledger or
 * received quantity (serials are decoupled from quantity — see
 * {@link ../receiving/serial-attach}).
 */

const DEFAULT_PARTS_BIN_BARCODE = 'TECH-PARTS';

// Statuses where the unit is already committed to an order or has left the
// building — never yank these into the parts bin from under a fulfillment flow.
const COMMITTED_STATUSES = new Set([
  'ALLOCATED',
  'PICKED',
  'PACKED',
  'LABELED',
  'STAGED',
  'SHIPPED',
  'SCRAPPED',
  'RMA',
]);

/**
 * True when a unit is committed to an order or already gone, so auto-sort must
 * leave it where it is. Exported for unit tests + reuse.
 */
export function isCommittedForPartsSort(status: string | null | undefined): boolean {
  return COMMITTED_STATUSES.has(String(status ?? '').trim().toUpperCase());
}

function autosortEnabled(): boolean {
  // Default ON; set PARTS_AUTOSORT_ENABLED=false to disable without a deploy.
  return String(process.env.PARTS_AUTOSORT_ENABLED ?? 'true').toLowerCase() !== 'false';
}

interface PartsBin {
  id: number;
  name: string;
  barcode: string | null;
}

// Cached per Function instance (mirrors resolveDefaultPutawayBinId in
// receiving/mark-received). `undefined` = not looked up yet; `null` = looked
// up and missing (so we don't hammer the DB on every grade).
let cachedPartsBin: PartsBin | null | undefined;

/** Resolve the Parts bin location, or null if it isn't seeded / configured. */
export async function resolvePartsBin(): Promise<PartsBin | null> {
  if (cachedPartsBin !== undefined) return cachedPartsBin;
  const barcode = (process.env.PARTS_BIN_BARCODE || DEFAULT_PARTS_BIN_BARCODE).trim();
  try {
    const loc =
      (await findLocationByBarcode(barcode)) ?? (await findLocationByName(barcode));
    cachedPartsBin = loc
      ? { id: loc.id, name: loc.name, barcode: loc.barcode ?? null }
      : null;
  } catch (err) {
    console.warn(`[parts-sort] parts bin lookup failed for barcode=${barcode}:`, err);
    cachedPartsBin = null;
  }
  return cachedPartsBin;
}

export interface SortSerialToPartsInput {
  serialUnitId: number;
  staffId?: number | null;
  station?: InventoryEventStation;
  clientEventId?: string | null;
  /** Run inside an existing transaction (receiving path); defaults to the pool. */
  client?: Pick<PoolClient, 'query'>;
}

export type SortSerialToPartsResult =
  | { sorted: true; bin: PartsBin }
  | { sorted: false; reason: 'disabled' | 'no_parts_bin' | 'not_found' | 'committed' | 'already_there' };

/**
 * Move a serial unit into the Parts bin and mark it STOCKED. No-op (returns
 * `sorted:false` with a reason) when auto-sort is disabled, the bin isn't
 * configured, the unit is missing, the unit is already committed to an order /
 * shipped, or it's already in the parts bin. Never throws on the no-op paths —
 * the caller's grade write must still succeed.
 */
export async function sortSerialUnitToParts(
  input: SortSerialToPartsInput,
): Promise<SortSerialToPartsResult> {
  if (!autosortEnabled()) return { sorted: false, reason: 'disabled' };

  const bin = await resolvePartsBin();
  if (!bin) return { sorted: false, reason: 'no_parts_bin' };

  const db = input.client ?? pool;

  const unitRes = await db.query<{
    id: number;
    sku: string | null;
    current_status: string;
    current_location: string | null;
  }>(
    `SELECT id, sku, current_status::text AS current_status, current_location
       FROM serial_units WHERE id = $1 LIMIT 1`,
    [input.serialUnitId],
  );
  const unit = unitRes.rows[0];
  if (!unit) return { sorted: false, reason: 'not_found' };

  if (isCommittedForPartsSort(unit.current_status)) {
    return { sorted: false, reason: 'committed' };
  }
  if (unit.current_location === bin.name && unit.current_status === 'STOCKED') {
    return { sorted: false, reason: 'already_there' };
  }

  // Resolve the prior bin id for the event's prev_bin_id (best-effort).
  let prevBinId: number | null = null;
  if (unit.current_location) {
    const prev =
      (await findLocationByName(unit.current_location)) ??
      (await findLocationByBarcode(unit.current_location));
    prevBinId = prev?.id ?? null;
  }

  await db.query(
    `UPDATE serial_units
        SET current_location = $1,
            current_status   = 'STOCKED'::serial_status_enum,
            updated_at = NOW()
      WHERE id = $2`,
    [bin.name, unit.id],
  );

  try {
    await recordInventoryEvent(
      {
        event_type: 'PUTAWAY',
        actor_staff_id: input.staffId ?? null,
        station: input.station ?? 'TECH',
        serial_unit_id: unit.id,
        sku: unit.sku,
        bin_id: bin.id,
        prev_bin_id: prevBinId,
        next_status: 'STOCKED',
        client_event_id: input.clientEventId ? `${input.clientEventId}:parts-sort` : null,
        notes: 'Auto-sorted to Parts bin (condition: For Parts)',
        payload: {
          auto_parts_sort: true,
          from: unit.current_location,
          to: bin.name,
        },
      },
      input.client,
    );
  } catch (err) {
    // Non-fatal: the move already landed; the audit row is best-effort.
    console.warn('[parts-sort] PUTAWAY event failed (non-fatal)', err);
  }

  return { sorted: true, bin };
}
