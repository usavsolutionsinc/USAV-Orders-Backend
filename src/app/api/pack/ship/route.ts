import { NextResponse } from 'next/server';
import { transaction } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Packing } from '@/lib/feature-flags';
import { parseScannedUrl } from '@/lib/scan-resolver';

/**
 * POST /api/pack/ship
 *
 * Phase 5 — THE CORE FIX. Single transaction that closes the loop:
 *   - Verifies scanned serials match the order's open allocations.
 *   - Transitions each allocation ALLOCATED|PICKED → SHIPPED.
 *   - Transitions each serial_units row → SHIPPED.
 *   - Appends one sku_stock_ledger row per unit with reason='SOLD' and
 *     delta=-1 (or -qty for Tier 1/2 lines via line_qty). The
 *     trg_sku_stock_from_ledger trigger projects the new on-hand count
 *     onto sku_stock.stock atomically — this is the single inventory
 *     decrement event for the order.
 *   - Emits PACKED, LABELED, SHIPPED inventory_events per unit, in order.
 *     Phase 5 collapses pack/label/ship into one operator action; future
 *     phases may split them when carrier-label timing matters.
 *   - Writes a single ORDERS-class packer_logs row and a SAL row so the
 *     existing dashboards keep showing the pack event.
 *   - Sets orders.status='shipped' last so any concurrent reader sees the
 *     event-side state before the order flag flips.
 *
 * Body:
 *   {
 *     order_id: number,
 *     serials?: string[],              // raw serial scans, GS1 URLs OK
 *     serial_unit_ids?: number[],      // explicit IDs (alternative to serials)
 *     tracking_number?: string,        // ORDERS scan_ref / shipment lookup
 *     carrier?: string,
 *     client_event_id?: string         // UUID; per-unit suffixed for idempotency
 *   }
 *
 * Provide either `serials` or `serial_unit_ids` (or both — they're merged).
 * Mismatch handling: if any scanned serial doesn't match an open
 * allocation for the order, the route returns 409 with the offending
 * serials and ZERO mutations are committed. Callers may unblock with
 * /api/pack/ship?override=true after operator confirmation — not yet
 * implemented; deliberate Phase 5 limitation.
 *
 * Gated by INVENTORY_V2_PACKING; off-flag returns 503 so the legacy
 * /api/packing-logs path remains authoritative.
 *
 * Permission: packing.complete_order.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Packing()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_PACKING flag is OFF', flag: 'INVENTORY_V2_PACKING' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const orderId = Number(body?.order_id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'order_id is required' }, { status: 400 });
  }

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

  // Resolve each raw serial (may be GS1 Digital Link URL) to a normalized
  // form for the lookup.
  const normalizedSerials = rawSerials.map((raw) => {
    const url = parseScannedUrl(raw);
    if (url && url.type === 'unit') return url.unitSerial.toUpperCase();
    return raw.toUpperCase();
  });

  const trackingNumber = String(body?.tracking_number || '').trim() || null;
  const carrier = String(body?.carrier || '').trim() || null;
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await transaction(async (client) => {
      // 1. Resolve all units in one round trip.
      const unitsQ = await client.query<{ id: number; sku: string | null; current_status: string; normalized_serial: string }>(
        `SELECT id, sku, current_status::text AS current_status, normalized_serial
           FROM serial_units
          WHERE id = ANY($1::int[])
             OR normalized_serial = ANY($2::text[])
          FOR UPDATE`,
        [explicitIds, normalizedSerials],
      );
      const units = unitsQ.rows;

      // 2. Validate: every input must resolve. Collect any misses.
      const foundBySerial = new Map<string, typeof units[number]>();
      const foundById = new Map<number, typeof units[number]>();
      for (const u of units) {
        foundBySerial.set(u.normalized_serial, u);
        foundById.set(u.id, u);
      }
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

      // 3. Validate: every unit must have an open allocation for THIS order
      //    in a pre-SHIPPED state. Mismatch → 409, zero mutations committed.
      const unitIds = units.map((u) => u.id);
      const allocQ = await client.query<{
        id: number;
        order_id: number;
        serial_unit_id: number;
        state: string;
      }>(
        `SELECT id, order_id, serial_unit_id, state::text AS state
           FROM order_unit_allocations
          WHERE serial_unit_id = ANY($1::int[])
            AND state <> 'RELEASED'
          FOR UPDATE`,
        [unitIds],
      );
      const allocByUnit = new Map<number, typeof allocQ.rows[number]>();
      for (const a of allocQ.rows) allocByUnit.set(a.serial_unit_id, a);

      const mismatches: Array<{ unitId: number; reason: string; allocationOrderId?: number; allocationState?: string }> = [];
      for (const u of units) {
        const a = allocByUnit.get(u.id);
        if (!a) {
          mismatches.push({ unitId: u.id, reason: 'no open allocation' });
        } else if (a.order_id !== orderId) {
          mismatches.push({
            unitId: u.id,
            reason: 'allocation belongs to a different order',
            allocationOrderId: a.order_id,
          });
        } else if (a.state === 'SHIPPED') {
          mismatches.push({
            unitId: u.id,
            reason: 'allocation already SHIPPED',
            allocationState: a.state,
          });
        }
      }
      if (mismatches.length > 0) {
        return { ok: false as const, status: 409, error: 'allocation mismatch', mismatches };
      }

      // 4. Resolve order metadata.
      const orderQ = await client.query<{ id: number; sku: string | null; shipment_id: number | null; status: string | null }>(
        `SELECT id, sku, shipment_id, status FROM orders WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [orderId],
      );
      const order = orderQ.rows[0];
      if (!order) {
        return { ok: false as const, status: 404, error: 'order not found' };
      }

      // 5. Per-unit transitions + events + ledger.
      const perUnit: Array<{
        unitId: number;
        allocationId: number;
        prevStatus: string;
        packedEventId: number | null;
        labeledEventId: number | null;
        shippedEventId: number | null;
        ledgerId: number | null;
      }> = [];

      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        const a = allocByUnit.get(u.id)!;

        // 5a. Allocation → SHIPPED.
        await client.query(
          `UPDATE order_unit_allocations SET state = 'SHIPPED' WHERE id = $1`,
          [a.id],
        );

        // 5b. inventory_events PACKED (idempotent).
        const packedKey = clientEventId ? `${clientEventId}:${u.id}:PACKED` : null;
        const packedEv = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
             event_type, actor_staff_id, station, serial_unit_id, sku,
             prev_status, next_status, client_event_id, payload
           )
           VALUES ('PACKED', $1, 'PACK', $2, $3, $4, 'PACKED', $5, $6::jsonb)
           ON CONFLICT (client_event_id) DO NOTHING
           RETURNING id`,
          [
            actorStaffId, u.id, u.sku, u.current_status, packedKey,
            JSON.stringify({ source: 'pack.ship', order_id: orderId, allocation_id: a.id, ordinal: i + 1 }),
          ],
        );

        // 5c. inventory_events LABELED.
        const labeledKey = clientEventId ? `${clientEventId}:${u.id}:LABELED` : null;
        const labeledEv = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
             event_type, actor_staff_id, station, serial_unit_id, sku,
             prev_status, next_status, client_event_id, payload
           )
           VALUES ('LABELED', $1, 'PACK', $2, $3, 'PACKED', 'LABELED', $4, $5::jsonb)
           ON CONFLICT (client_event_id) DO NOTHING
           RETURNING id`,
          [
            actorStaffId, u.id, u.sku, labeledKey,
            JSON.stringify({ source: 'pack.ship', order_id: orderId, tracking_number: trackingNumber, carrier }),
          ],
        );

        // 5d. sku_stock_ledger row — THE DECREMENT. delta=-1 per unit on
        //     the WAREHOUSE dimension. Trigger fn_recompute_sku_stock()
        //     projects this onto sku_stock atomically.
        let ledgerId: number | null = null;
        if (u.sku) {
          const ledger = await client.query<{ id: number }>(
            `INSERT INTO sku_stock_ledger (
               sku, delta, reason, dimension, staff_id,
               ref_serial_unit_id, ref_order_id, ref_shipment_id, notes
             )
             VALUES ($1, -1, 'SOLD', 'WAREHOUSE', $2, $3, $4, $5, $6)
             RETURNING id`,
            [
              u.sku, actorStaffId, u.id, orderId, order.shipment_id ?? null,
              `pack.ship order=${orderId} alloc=${a.id} unit=${u.id}`,
            ],
          );
          ledgerId = ledger.rows[0]?.id ?? null;
        }

        // 5e. serial_units → SHIPPED.
        await client.query(
          `UPDATE serial_units
              SET current_status = 'SHIPPED'::serial_status_enum,
                  updated_at = NOW()
            WHERE id = $1`,
          [u.id],
        );

        // 5f. inventory_events SHIPPED — the lifecycle event that pairs
        //     with the ledger decrement.
        const shippedKey = clientEventId ? `${clientEventId}:${u.id}:SHIPPED` : null;
        const shippedEv = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
             event_type, actor_staff_id, station, serial_unit_id, sku,
             prev_status, next_status, stock_ledger_id, client_event_id, payload
           )
           VALUES ('SHIPPED', $1, 'SHIP', $2, $3, 'LABELED', 'SHIPPED', $4, $5, $6::jsonb)
           ON CONFLICT (client_event_id) DO NOTHING
           RETURNING id`,
          [
            actorStaffId, u.id, u.sku, ledgerId, shippedKey,
            JSON.stringify({
              source: 'pack.ship', order_id: orderId, allocation_id: a.id,
              tracking_number: trackingNumber, carrier,
            }),
          ],
        );

        perUnit.push({
          unitId: u.id,
          allocationId: a.id,
          prevStatus: u.current_status,
          packedEventId: packedEv.rows[0]?.id ?? null,
          labeledEventId: labeledEv.rows[0]?.id ?? null,
          shippedEventId: shippedEv.rows[0]?.id ?? null,
          ledgerId,
        });
      }

      // 6. One packer_logs row for the order — keeps the existing
      //    shipped-dashboard query working.
      const packerLog = await client.query<{ id: number }>(
        `INSERT INTO packer_logs (shipment_id, scan_ref, tracking_type, packed_by)
         VALUES ($1, $2, 'ORDERS', $3)
         RETURNING id`,
        [order.shipment_id ?? null, trackingNumber, actorStaffId],
      );

      // 7. One SAL row for cross-station visibility.
      await client.query(
        `INSERT INTO station_activity_logs (
           station, activity_type, shipment_id, scan_ref, staff_id, packer_log_id, notes, metadata
         )
         VALUES ('PACK', 'PACK_SHIPPED', $1, $2, $3, $4, $5, $6::jsonb)`,
        [
          order.shipment_id ?? null,
          trackingNumber,
          actorStaffId,
          packerLog.rows[0]?.id ?? null,
          `inventory v2 shipped order=${orderId} units=${perUnit.length}`,
          JSON.stringify({
            source: 'pack.ship',
            order_id: orderId,
            tracking_number: trackingNumber,
            carrier,
            units: perUnit.length,
          }),
        ],
      );

      // 8. Flip the order status last so observers see the events first.
      await client.query(
        `UPDATE orders SET status = 'shipped' WHERE id = $1`,
        [orderId],
      );

      return {
        ok: true as const,
        orderId,
        shipped_unit_count: perUnit.length,
        units: perUnit,
        packer_log_id: packerLog.rows[0]?.id ?? null,
      };
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'pack ship failed';
    console.error('[POST /api/pack/ship] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'packing.complete_order' });
