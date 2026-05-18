/**
 * returns.ts
 * ────────────────────────────────────────────────────────────────────
 * Phase 7 returns intake transaction. Shared by /api/returns/intake
 * and the /admin/inventory-v2/returns admin page so the bookkeeping
 * lives in one place.
 *
 * Per resolved unit, in one transaction:
 *   - sku_stock_ledger row +1 reason='RETURN_CUSTOMER' (the trigger
 *     projects the qty back onto sku_stock.stock automatically).
 *   - serial_units.current_status → RETURNED.
 *   - inventory_events RETURNED with prev_status = actual prior state.
 *
 * Idempotent via per-unit suffixed clientEventId. Rejects with 404
 * (with the missing serials/ids) if any input cannot be resolved —
 * zero mutations committed in that case so the operator can fix the
 * input and retry.
 *
 * Caller responsibilities: feature-flag check, permission gate,
 * scan-URL normalization (callers pre-extract serials from GS1
 * Digital Link URLs via parseScannedUrl before invoking).
 */

import { transaction } from '@/lib/neon-client';

export interface ReturnsIntakeInput {
  /** Normalized serial strings (already upper-cased, GS1 URLs extracted). */
  serials: string[];
  /** Explicit serial_units.id values, alternative to serials. */
  serialUnitIds: number[];
  /** Optional tracking number recorded on each event for cross-link. */
  trackingNumber?: string | null;
  /** Optional orders.id this return belongs to. */
  orderId?: number | null;
  /** Free-form reason stamped on each event + ledger row. */
  reason?: string | null;
  /** UUID; per-unit suffixed for retry-safe inventory_events inserts. */
  clientEventId?: string | null;
  actorStaffId: number | null;
}

export interface ReturnsIntakeSuccess {
  ok: true;
  returnedUnitCount: number;
  orderId: number | null;
  trackingNumber: string | null;
  units: Array<{
    unitId: number;
    prevStatus: string;
    eventId: number | null;
    ledgerId: number | null;
  }>;
}

export interface ReturnsIntakeFailure {
  ok: false;
  status: 400 | 404;
  error: string;
  missingSerials?: string[];
  missingIds?: number[];
}

export type ReturnsIntakeResult = ReturnsIntakeSuccess | ReturnsIntakeFailure;

export async function processReturnsIntake(input: ReturnsIntakeInput): Promise<ReturnsIntakeResult> {
  if (input.serials.length === 0 && input.serialUnitIds.length === 0) {
    return { ok: false, status: 400, error: 'serials or serial_unit_ids is required' };
  }

  const trackingNumber = input.trackingNumber?.trim() || null;
  const reason = input.reason?.trim() || 'customer return';

  return transaction<ReturnsIntakeResult>(async (client) => {
    const unitsQ = await client.query<{
      id: number;
      sku: string | null;
      current_status: string;
      normalized_serial: string;
    }>(
      `SELECT id, sku, current_status::text AS current_status, normalized_serial
         FROM serial_units
        WHERE id = ANY($1::int[])
           OR normalized_serial = ANY($2::text[])
        FOR UPDATE`,
      [input.serialUnitIds, input.serials],
    );
    const units = unitsQ.rows;

    const foundBySerial = new Set(units.map((u) => u.normalized_serial));
    const foundById = new Set(units.map((u) => u.id));
    const missingSerials = input.serials.filter((s) => !foundBySerial.has(s));
    const missingIds = input.serialUnitIds.filter((id) => !foundById.has(id));
    if (missingSerials.length || missingIds.length) {
      return {
        ok: false,
        status: 404,
        error: 'some units not found',
        missingSerials,
        missingIds,
      };
    }

    const perUnit: ReturnsIntakeSuccess['units'] = [];

    for (let i = 0; i < units.length; i++) {
      const u = units[i];

      let ledgerId: number | null = null;
      if (u.sku) {
        const ledgerQ = await client.query<{ id: number }>(
          `INSERT INTO sku_stock_ledger (
             sku, delta, reason, dimension, staff_id,
             ref_serial_unit_id, ref_order_id, notes
           )
           VALUES ($1, 1, 'RETURN_CUSTOMER', 'WAREHOUSE', $2, $3, $4, $5)
           RETURNING id`,
          [u.sku, input.actorStaffId, u.id, input.orderId ?? null, reason],
        );
        ledgerId = ledgerQ.rows[0]?.id ?? null;
      }

      await client.query(
        `UPDATE serial_units
            SET current_status = 'RETURNED'::serial_status_enum,
                updated_at = NOW()
          WHERE id = $1`,
        [u.id],
      );

      const perUnitKey = input.clientEventId ? `${input.clientEventId}:return:${u.id}` : null;
      const evQ = await client.query<{ id: number }>(
        `INSERT INTO inventory_events (
           event_type, actor_staff_id, station,
           serial_unit_id, sku,
           prev_status, next_status, stock_ledger_id,
           scan_token, client_event_id, notes, payload
         )
         VALUES ('RETURNED', $1, 'RECEIVING',
                 $2, $3,
                 $4, 'RETURNED', $5,
                 $6, $7, $8, $9::jsonb)
         ON CONFLICT (client_event_id) DO NOTHING
         RETURNING id`,
        [
          input.actorStaffId, u.id, u.sku, u.current_status, ledgerId,
          trackingNumber, perUnitKey, reason,
          JSON.stringify({
            source: 'returns.intake',
            order_id: input.orderId ?? null,
            tracking_number: trackingNumber,
            ordinal: i + 1,
          }),
        ],
      );

      perUnit.push({
        unitId: u.id,
        prevStatus: u.current_status,
        eventId: evQ.rows[0]?.id ?? null,
        ledgerId,
      });
    }

    return {
      ok: true,
      returnedUnitCount: perUnit.length,
      orderId: input.orderId ?? null,
      trackingNumber,
      units: perUnit,
    };
  });
}
