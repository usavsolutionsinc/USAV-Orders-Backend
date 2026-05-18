/**
 * hold.ts
 * ────────────────────────────────────────────────────────────────────
 * Shared hold + release transactions. Used by both the
 * /api/serial-units/[id]/{hold,release} routes and the
 * /admin/inventory-v2/holds admin page so the lifecycle semantics live
 * in exactly one place.
 *
 * Behavior preserved from the original route logic:
 *   - hold: rejects if unit is already ON_HOLD. Stashes prev status in
 *     inventory_events.payload.restore_status so the release helper can
 *     auto-recover.
 *   - release: optional force_status override. If absent, reads the
 *     most recent HELD event's payload.restore_status; falls back to
 *     STOCKED.
 *   - Both: idempotent via clientEventId on inventory_events.
 *
 * Caller responsibilities: feature-flag check, permission gate,
 * actorStaffId resolution.
 */

import { transaction } from '@/lib/neon-client';

const RESTORABLE_STATUSES = new Set([
  'STOCKED', 'TRIAGED', 'IN_REPAIR', 'REPAIR_DONE', 'IN_TEST',
  'GRADED', 'ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED',
]);

export function isRestorableStatus(status: string): boolean {
  return RESTORABLE_STATUSES.has(status);
}

export interface HoldUnitInput {
  serialUnitId: number;
  reason: string;
  clientEventId?: string | null;
  actorStaffId: number | null;
}

export interface HoldUnitSuccess {
  ok: true;
  serialUnitId: number;
  prevStatus: string;
  nextStatus: 'ON_HOLD';
  restoreStatus: string;
  inventoryEventId: number | null;
}

export interface HoldUnitFailure {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
}

export type HoldUnitResult = HoldUnitSuccess | HoldUnitFailure;

export async function holdUnit(input: HoldUnitInput): Promise<HoldUnitResult> {
  if (!input.reason || !input.reason.trim()) {
    return { ok: false, status: 400, error: 'reason is required' };
  }
  return transaction<HoldUnitResult>(async (client) => {
    const unitQ = await client.query<{ id: number; sku: string | null; current_status: string }>(
      `SELECT id, sku, current_status::text AS current_status
         FROM serial_units WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [input.serialUnitId],
    );
    const unit = unitQ.rows[0];
    if (!unit) return { ok: false, status: 404, error: 'serial_units row not found' };
    if (unit.current_status === 'ON_HOLD') {
      return { ok: false, status: 409, error: 'unit is already ON_HOLD' };
    }

    await client.query(
      `UPDATE serial_units
          SET current_status = 'ON_HOLD'::serial_status_enum,
              updated_at = NOW()
        WHERE id = $1`,
      [unit.id],
    );

    const evQ = await client.query<{ id: number }>(
      `INSERT INTO inventory_events (
         event_type, actor_staff_id, station,
         serial_unit_id, sku,
         prev_status, next_status,
         client_event_id, notes, payload
       )
       VALUES ('HELD', $1, 'SYSTEM',
               $2, $3,
               $4, 'ON_HOLD',
               $5, $6, $7::jsonb)
       ON CONFLICT (client_event_id) DO NOTHING
       RETURNING id`,
      [
        input.actorStaffId,
        unit.id,
        unit.sku,
        unit.current_status,
        input.clientEventId ?? null,
        input.reason.trim(),
        JSON.stringify({
          source: 'serial-units.hold',
          restore_status: unit.current_status,
        }),
      ],
    );

    return {
      ok: true,
      serialUnitId: unit.id,
      prevStatus: unit.current_status,
      nextStatus: 'ON_HOLD',
      restoreStatus: unit.current_status,
      inventoryEventId: evQ.rows[0]?.id ?? null,
    };
  });
}

export interface ReleaseUnitInput {
  serialUnitId: number;
  reason?: string | null;
  forceStatus?: string | null;
  clientEventId?: string | null;
  actorStaffId: number | null;
}

export interface ReleaseUnitSuccess {
  ok: true;
  serialUnitId: number;
  prevStatus: 'ON_HOLD';
  nextStatus: string;
  forced: boolean;
  inventoryEventId: number | null;
}

export interface ReleaseUnitFailure {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
  currentStatus?: string;
}

export type ReleaseUnitResult = ReleaseUnitSuccess | ReleaseUnitFailure;

export async function releaseUnit(input: ReleaseUnitInput): Promise<ReleaseUnitResult> {
  const forceStatus = input.forceStatus ? input.forceStatus.trim().toUpperCase() : null;
  if (forceStatus && !isRestorableStatus(forceStatus)) {
    return { ok: false, status: 400, error: `force_status invalid: ${forceStatus}` };
  }
  return transaction<ReleaseUnitResult>(async (client) => {
    const unitQ = await client.query<{ id: number; sku: string | null; current_status: string }>(
      `SELECT id, sku, current_status::text AS current_status
         FROM serial_units WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [input.serialUnitId],
    );
    const unit = unitQ.rows[0];
    if (!unit) return { ok: false, status: 404, error: 'serial_units row not found' };
    if (unit.current_status !== 'ON_HOLD') {
      return {
        ok: false,
        status: 409,
        error: 'unit is not ON_HOLD',
        currentStatus: unit.current_status,
      };
    }

    // Recover the pre-hold status from the most recent HELD event.
    let restoreStatus = forceStatus ?? 'STOCKED';
    if (!forceStatus) {
      const heldQ = await client.query<{ restore_status: string | null }>(
        `SELECT payload->>'restore_status' AS restore_status
           FROM inventory_events
          WHERE serial_unit_id = $1 AND event_type = 'HELD'
          ORDER BY occurred_at DESC, id DESC
          LIMIT 1`,
        [unit.id],
      );
      const candidate = heldQ.rows[0]?.restore_status?.toUpperCase() ?? null;
      if (candidate && isRestorableStatus(candidate)) restoreStatus = candidate;
    }

    await client.query(
      `UPDATE serial_units
          SET current_status = $1::serial_status_enum,
              updated_at = NOW()
        WHERE id = $2`,
      [restoreStatus, unit.id],
    );

    const evQ = await client.query<{ id: number }>(
      `INSERT INTO inventory_events (
         event_type, actor_staff_id, station,
         serial_unit_id, sku,
         prev_status, next_status,
         client_event_id, notes, payload
       )
       VALUES ('RELEASED_HOLD', $1, 'SYSTEM',
               $2, $3,
               'ON_HOLD', $4,
               $5, $6, $7::jsonb)
       ON CONFLICT (client_event_id) DO NOTHING
       RETURNING id`,
      [
        input.actorStaffId, unit.id, unit.sku, restoreStatus,
        input.clientEventId ?? null,
        input.reason?.trim() || null,
        JSON.stringify({
          source: 'serial-units.release',
          forced: !!forceStatus,
        }),
      ],
    );

    return {
      ok: true,
      serialUnitId: unit.id,
      prevStatus: 'ON_HOLD',
      nextStatus: restoreStatus,
      forced: !!forceStatus,
      inventoryEventId: evQ.rows[0]?.id ?? null,
    };
  });
}
