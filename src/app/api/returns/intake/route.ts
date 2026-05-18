import { NextResponse } from 'next/server';
import { transaction } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Returns } from '@/lib/feature-flags';
import { parseScannedUrl } from '@/lib/scan-resolver';

/**
 * POST /api/returns/intake
 *
 * Phase 7. Records customer returns at the dock and feeds the units back
 * into the system. For each scanned unit:
 *   - inventory_events RETURNED (prev=current, next='RETURNED').
 *   - serial_units.current_status → RETURNED.
 *   - sku_stock_ledger row +1 reason='RETURN_CUSTOMER' dimension='WAREHOUSE'.
 *     The trigger projects the qty back into sku_stock.stock automatically.
 *
 * Body:
 *   {
 *     tracking_number?: string,       // optional, recorded in payload
 *     order_id?: number,              // optional, recorded in payload
 *     reason?: string,                // free-form, stored on each event
 *     serials?: string[],             // raw serials or GS1 URLs
 *     serial_unit_ids?: number[],
 *     client_event_id?: string        // UUID, per-unit suffixed for idempotency
 *   }
 *
 * Single transaction. After intake, operators run the existing triage
 * flow (set condition, push back through tech) — that's not part of this
 * endpoint by design; this only logs the return.
 *
 * Gated by INVENTORY_V2_RETURNS; off-flag returns 503.
 * Permission: receiving.mark_received (return intake lives at receiving).
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Returns()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_RETURNS flag is OFF', flag: 'INVENTORY_V2_RETURNS' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const trackingNumber = String(body?.tracking_number || '').trim() || null;
  const orderIdRaw = Number(body?.order_id);
  const orderIdInput =
    Number.isFinite(orderIdRaw) && orderIdRaw > 0 ? Math.floor(orderIdRaw) : null;
  const reason = String(body?.reason || '').trim() || 'customer return';
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  const rawSerials: string[] = Array.isArray(body?.serials)
    ? body.serials.map((s: unknown) => String(s ?? '').trim()).filter(Boolean)
    : [];
  const explicitIds: number[] = Array.isArray(body?.serial_unit_ids)
    ? body.serial_unit_ids
        .map((x: unknown) => Number(x))
        .filter((n: number) => Number.isFinite(n) && n > 0)
        .map((n: number) => Math.floor(n))
    : [];
  if (rawSerials.length === 0 && explicitIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'serials or serial_unit_ids is required' },
      { status: 400 },
    );
  }

  const normalizedSerials = rawSerials.map((raw) => {
    const url = parseScannedUrl(raw);
    return url && url.type === 'unit' ? url.unitSerial.toUpperCase() : raw.toUpperCase();
  });

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await transaction(async (client) => {
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
        [explicitIds, normalizedSerials],
      );
      const units = unitsQ.rows;

      const foundBySerial = new Set(units.map((u) => u.normalized_serial));
      const foundById = new Set(units.map((u) => u.id));
      const missingSerials = normalizedSerials.filter((s) => !foundBySerial.has(s));
      const missingIds = explicitIds.filter((id) => !foundById.has(id));
      if (missingSerials.length || missingIds.length) {
        return {
          ok: false as const,
          status: 404,
          error: 'some units not found',
          missing_serials: missingSerials,
          missing_ids: missingIds,
        };
      }

      const perUnit: Array<{
        unitId: number;
        prevStatus: string;
        eventId: number | null;
        ledgerId: number | null;
      }> = [];

      for (let i = 0; i < units.length; i++) {
        const u = units[i];

        // sku_stock_ledger +1 reason='RETURN_CUSTOMER'.
        let ledgerId: number | null = null;
        if (u.sku) {
          const ledger = await client.query<{ id: number }>(
            `INSERT INTO sku_stock_ledger (
               sku, delta, reason, dimension, staff_id,
               ref_serial_unit_id, ref_order_id, notes
             )
             VALUES ($1, 1, 'RETURN_CUSTOMER', 'WAREHOUSE', $2, $3, $4, $5)
             RETURNING id`,
            [u.sku, actorStaffId, u.id, orderIdInput, reason],
          );
          ledgerId = ledger.rows[0]?.id ?? null;
        }

        // serial_units → RETURNED.
        await client.query(
          `UPDATE serial_units
              SET current_status = 'RETURNED'::serial_status_enum,
                  updated_at = NOW()
            WHERE id = $1`,
          [u.id],
        );

        const key = clientEventId ? `${clientEventId}:return:${u.id}` : null;
        const ev = await client.query<{ id: number }>(
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
            actorStaffId, u.id, u.sku, u.current_status, ledgerId,
            trackingNumber, key, reason,
            JSON.stringify({
              source: 'returns.intake',
              order_id: orderIdInput,
              tracking_number: trackingNumber,
              ordinal: i + 1,
            }),
          ],
        );

        perUnit.push({
          unitId: u.id,
          prevStatus: u.current_status,
          eventId: ev.rows[0]?.id ?? null,
          ledgerId,
        });
      }

      return {
        ok: true as const,
        returned_unit_count: perUnit.length,
        order_id: orderIdInput,
        tracking_number: trackingNumber,
        units: perUnit,
      };
    });

    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'returns intake failed';
    console.error('[POST /api/returns/intake] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });
