/**
 * sync-legacy-pack.ts
 * ────────────────────────────────────────────────────────────────────
 * Phase 3 deliverable #2 — inverse dual-write.
 *
 * When one of the legacy packer_logs INSERT sites runs (and the
 * INVENTORY_V2_LEGACY_PACK_MIRROR flag is ON), this helper mirrors the
 * SHIPPED state into the v2 system for any order whose units have
 * open allocations:
 *
 *   1. Find every orders.id linked to the packer_log's shipment_id.
 *   2. For each linked order, find allocations in any open state
 *      (ALLOCATED, PICKING, PICKED, PACKED, LABELED, STAGED).
 *   3. For each open allocation: transition serial_units → SHIPPED,
 *      flip order_unit_allocations.state = 'SHIPPED', emit a SHIPPED
 *      inventory_event tagged with the legacy packer_log id.
 *
 * Properties:
 *   - Idempotent. Deterministic client_event_id
 *     `legacy-pack-mirror:pl-{packerLogId}:unit-{unitId}` prevents
 *     double-write on retry.
 *   - Non-blocking. The caller awaits this but should not let mirror
 *     errors break the original packer_logs insert — call sites wrap
 *     in try/catch.
 *   - No-op when:
 *       - flag is OFF
 *       - shipmentId is null
 *       - no linked orders have open allocations
 *
 * Companion: reconciliation script `scripts/reconcile-packer-logs.mjs`
 * verifies drift before/after a packer_logs INSERT.
 */

import pool from '@/lib/db';
import { transition } from '@/lib/inventory/state-machine';
import { isInventoryV2LegacyPackMirror } from '@/lib/feature-flags';

export interface MirrorInput {
  /** Source packer_logs row id (used for deterministic idempotency key). */
  packerLogId: number;
  /** Shipment to resolve orders against. */
  shipmentId: number | string | null;
  /** When known, attributed to inventory_events.actor_staff_id. */
  actorStaffId?: number | null;
}

export type MirrorResult =
  | { ok: true; mirrored: number; skipped?: string }
  | { ok: false; error: string; mirrored: number };

/**
 * Mirrors SHIPPED state from a legacy packer_logs row into the v2
 * allocation system. See file header for full semantics.
 */
export async function mirrorLegacyPackToAllocations(input: MirrorInput): Promise<MirrorResult> {
  if (!isInventoryV2LegacyPackMirror()) {
    return { ok: true, mirrored: 0, skipped: 'flag-off' };
  }
  if (input.shipmentId == null || input.shipmentId === '') {
    return { ok: true, mirrored: 0, skipped: 'no-shipment-id' };
  }

  const shipIdNum = Number(input.shipmentId);
  if (!Number.isFinite(shipIdNum) || shipIdNum <= 0) {
    return { ok: true, mirrored: 0, skipped: 'invalid-shipment-id' };
  }

  let mirrored = 0;
  try {
    // 1. Resolve orders linked to this shipment.
    const ordersQ = await pool.query<{ id: number }>(
      `SELECT id FROM orders WHERE shipment_id = $1`,
      [shipIdNum],
    );
    if (ordersQ.rows.length === 0) {
      return { ok: true, mirrored: 0, skipped: 'no-linked-orders' };
    }
    const orderIds = ordersQ.rows.map((r) => r.id);

    // 2. Resolve open allocations for those orders.
    const allocQ = await pool.query<{
      id: string;
      serial_unit_id: number;
      order_id: number;
      state: string;
    }>(
      `SELECT id, serial_unit_id, order_id, state::text
         FROM order_unit_allocations
        WHERE order_id = ANY($1)
          AND state IN ('ALLOCATED','PICKING','PICKED','PACKED','LABELED','STAGED')`,
      [orderIds],
    );
    if (allocQ.rows.length === 0) {
      return { ok: true, mirrored: 0, skipped: 'no-open-allocations' };
    }

    // 3. Per-unit transition. One short-lived txn per unit so a single
    //    failure doesn't cascade across the whole shipment.
    for (const alloc of allocQ.rows) {
      const clientEventId = `legacy-pack-mirror:pl-${input.packerLogId}:unit-${alloc.serial_unit_id}`;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const txResult = await transition(
          {
            unitId: alloc.serial_unit_id,
            to: 'SHIPPED',
            eventType: 'SHIPPED',
            actorStaffId: input.actorStaffId ?? null,
            station: 'SYSTEM',
            clientEventId,
            notes: `legacy-pack mirror from packer_logs #${input.packerLogId}`,
            payload: {
              source: 'legacy_pack_mirror',
              packer_log_id: input.packerLogId,
              shipment_id: shipIdNum,
              allocation_id: Number(alloc.id),
              order_id: alloc.order_id,
              prior_state: alloc.state,
            },
          },
          client,
        );
        if (!txResult.ok) {
          // Idempotent retries land here when the unit is already SHIPPED.
          // 409 with from=SHIPPED is success; everything else propagates.
          if (txResult.status === 409 && txResult.from === 'SHIPPED') {
            await client.query('ROLLBACK');
            mirrored++;
            continue;
          }
          await client.query('ROLLBACK');
          console.warn(
            `[legacy-pack-mirror] unit ${alloc.serial_unit_id} pl#${input.packerLogId} ` +
              `transition failed: status=${txResult.status} from=${txResult.from} error=${txResult.error}`,
          );
          continue;
        }

        await client.query(
          `UPDATE order_unit_allocations SET state = 'SHIPPED' WHERE id = $1`,
          [alloc.id],
        );
        await client.query('COMMIT');
        mirrored++;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* noop */ }
        console.warn(
          `[legacy-pack-mirror] unit ${alloc.serial_unit_id} pl#${input.packerLogId} ` +
            `unexpected error:`,
          err instanceof Error ? err.message : err,
        );
      } finally {
        client.release();
      }
    }

    return { ok: true, mirrored };
  } catch (err) {
    return {
      ok: false,
      mirrored,
      error: err instanceof Error ? err.message : 'legacy-pack-mirror failed',
    };
  }
}
