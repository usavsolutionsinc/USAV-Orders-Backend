import type { PoolClient } from 'pg';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { recordInventoryEvent } from '@/lib/inventory/events';
import { safeRandomUUID } from '@/lib/safe-uuid';

/**
 * serial-move.ts
 * ────────────────────────────────────────────────────────────────────
 * Re-home a serial's receiving-line membership IN PLACE. The condition+serial
 * row's LINK (combine two rows into one) / UNLINK (split a serial to its own
 * line) affordances need to move a *scanned* serial from one receiving_line to
 * another WITHOUT losing the unit's testing verdict.
 *
 * The display resolves a serial's *current* line from the LATEST
 * `inventory_events` row with a non-null `receiving_line_id` (see
 * `fetchSerialsForLines` / `resolveCurrentReceivingLineIds`), falling back to the
 * frozen provenance origin. So the move is simply: write ONE audit-only `MOVED`
 * event pointing at the target line, carrying the unit's *current* status forward
 * (`recordInventoryEvent` never mutates `serial_units.current_status`, so the
 * verdict is preserved). It deliberately does NOT detach+reattach (which deletes
 * and recreates the `serial_unit`, losing its verdict) and never touches quantity
 * or the stock ledger. Idempotent via `client_event_id`.
 *
 * Deps-injected (default real impls) so unit tests run DB-free, per
 * backend-patterns.md. Line create / empty-line delete around a move are the
 * caller's concern (add-unmatched-line / receiving-lines DELETE).
 */

export interface MoveSerialInput {
  serial_unit_id: number;
  target_receiving_line_id: number;
  staff_id?: number | null;
  client_event_id?: string | null;
}

export interface MoveSerialResult {
  moved: boolean;
  serial_unit_id: number;
  from_receiving_line_id: number | null;
  to_receiving_line_id: number;
  inventory_event_id: number | null;
  /** True when the serial was already on the target line — friendly no-op. */
  already_there: boolean;
}

interface SerialRow {
  id: number;
  sku: string | null;
  current_status: string;
}
interface LineRow {
  id: number;
  receiving_id: number | null;
  sku: string | null;
}

export interface MoveSerialDeps {
  runTransaction: <T>(orgId: OrgId, cb: (client: PoolClient) => Promise<T>) => Promise<T>;
  /** Locked read of the serial unit (FOR UPDATE) — null when absent. */
  loadSerial: (client: PoolClient, serialUnitId: number, orgId: OrgId) => Promise<SerialRow | null>;
  /** Read of the target receiving line — null when absent. */
  loadLine: (client: PoolClient, lineId: number, orgId: OrgId) => Promise<LineRow | null>;
  /** The serial's CURRENT line id (latest event with a receiving_line_id), or null. */
  currentLineId: (client: PoolClient, serialUnitId: number, orgId: OrgId) => Promise<number | null>;
  recordInventoryEvent: typeof recordInventoryEvent;
}

const defaultDeps: MoveSerialDeps = {
  runTransaction: withTenantTransaction,
  loadSerial: async (client, serialUnitId, orgId) => {
    const r = await client.query<SerialRow>(
      `SELECT id, sku, current_status FROM serial_units
        WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [serialUnitId, orgId],
    );
    return r.rows[0] ?? null;
  },
  loadLine: async (client, lineId, orgId) => {
    const r = await client.query<LineRow>(
      `SELECT id, receiving_id, sku FROM receiving_lines
        WHERE id = $1 AND organization_id = $2`,
      [lineId, orgId],
    );
    return r.rows[0] ?? null;
  },
  currentLineId: async (client, serialUnitId, orgId) => {
    const r = await client.query<{ receiving_line_id: number | null }>(
      `SELECT receiving_line_id FROM inventory_events
        WHERE serial_unit_id = $1 AND organization_id = $2 AND receiving_line_id IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [serialUnitId, orgId],
    );
    return r.rows[0]?.receiving_line_id ?? null;
  },
  recordInventoryEvent,
};

export async function moveSerialToLine(
  input: MoveSerialInput,
  orgId: OrgId,
  deps: MoveSerialDeps = defaultDeps,
): Promise<MoveSerialResult | null> {
  const serialUnitId = Math.floor(Number(input.serial_unit_id));
  const targetLineId = Math.floor(Number(input.target_receiving_line_id));
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) return null;
  if (!Number.isFinite(targetLineId) || targetLineId <= 0) return null;

  return deps.runTransaction(orgId, async (client) => {
    const serial = await deps.loadSerial(client, serialUnitId, orgId);
    if (!serial) throw new Error(`serial_unit ${serialUnitId} not found`);

    const targetLine = await deps.loadLine(client, targetLineId, orgId);
    if (!targetLine) throw new Error(`receiving_line ${targetLineId} not found`);

    const fromLineId = await deps.currentLineId(client, serialUnitId, orgId);
    if (fromLineId === targetLineId) {
      return {
        moved: false,
        serial_unit_id: serialUnitId,
        from_receiving_line_id: fromLineId,
        to_receiving_line_id: targetLineId,
        inventory_event_id: null,
        already_there: true,
      };
    }

    // Audit-only MOVED event at the target line. next_status = the unit's CURRENT
    // status, so the testing verdict is carried forward untouched.
    const event = await deps.recordInventoryEvent(
      {
        event_type: 'MOVED',
        actor_staff_id: input.staff_id ?? null,
        station: 'RECEIVING',
        receiving_id: targetLine.receiving_id,
        receiving_line_id: targetLineId,
        serial_unit_id: serialUnitId,
        sku: serial.sku ?? targetLine.sku,
        prev_status: serial.current_status,
        next_status: serial.current_status,
        stock_ledger_id: null,
        // Idempotency key. A caller-supplied id makes a network retry a safe
        // no-op; the fallback is a FRESH uuid (never a content-derived
        // `move-A-to-B`, which would collide with an earlier event on a genuine
        // repeat move back to a previously-visited line — silently dropping the
        // MOVED row so the serial reverts).
        client_event_id: input.client_event_id
          ? `${input.client_event_id}:move`
          : `move-${safeRandomUUID()}`,
        notes:
          fromLineId != null
            ? `Serial re-homed from line ${fromLineId} to line ${targetLineId}`
            : `Serial homed to line ${targetLineId}`,
        payload: { serial_move: true, from_receiving_line_id: fromLineId },
      },
      client,
      orgId,
    );

    return {
      moved: true,
      serial_unit_id: serialUnitId,
      from_receiving_line_id: fromLineId,
      to_receiving_line_id: targetLineId,
      inventory_event_id: event.id,
      already_there: false,
    };
  });
}
