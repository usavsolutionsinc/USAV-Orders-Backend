import { NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseScannedUrl } from '@/lib/scan-resolver';
import { transition } from '@/lib/inventory/state-machine';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { tapWorkflow } from '@/lib/workflow/tap';
import { isUnifiedEngineFulfillmentTaps } from '@/lib/feature-flags';

/**
 * Thrown when a unit's guarded SHIPPED transition is rejected (it isn't in a
 * shippable state). Caught by the outer try so the whole transaction rolls
 * back — preserving the route's "zero mutations on failure" guarantee — and
 * surfaced as the transition()'s own status (404/409).
 */
class UnitTransitionError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly unitId: number,
    readonly fromStatus: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'UnitTransitionError';
  }
}

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
 * Permission: packing.complete_order.
 */
export const POST = withAuth(async (request, ctx) => {
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
  const orgId = ctx.organizationId;

  try {
    // GUC-wrapped: every tenant table this route touches (orders, order_unit_allocations,
    // serial_units, inventory_events, sku_stock_ledger, packer_logs, station_activity_logs)
    // has RLS enabled, so under the app_tenant pool the policies scope each statement to
    // this org and the GUC column default stamps org on the raw INSERTs. Explicit
    // organization_id predicates below are kept as defense-in-depth.
    const result = await withTenantTransaction(orgId, async (client) => {
      // 1. Resolve all units in one round trip.
      const unitsQ = await client.query<{ id: number; sku: string | null; current_status: string; normalized_serial: string }>(
        `SELECT id, sku, current_status::text AS current_status, normalized_serial
           FROM serial_units
          WHERE (id = ANY($1::int[])
             OR normalized_serial = ANY($2::text[]))
            AND organization_id = $3
          FOR UPDATE`,
        [explicitIds, normalizedSerials, orgId],
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
            AND organization_id = $2
          FOR UPDATE`,
        [unitIds, orgId],
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
        `SELECT id, sku, shipment_id, status FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
        [orderId, orgId],
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
          `UPDATE order_unit_allocations SET state = 'SHIPPED' WHERE id = $1 AND organization_id = $2`,
          [a.id, orgId],
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

        // 5e+5f. serial_units → SHIPPED via the guarded state machine. This
        //     writes current_status=SHIPPED AND emits the single SHIPPED
        //     inventory_event (carrying the ledger linkage via stockLedgerId).
        //     The unit's real from-state is ALLOCATED or PICKED (or another
        //     pre-SHIPPED state); we do NOT pass expectedFrom since it varies.
        //     A rejection means the unit isn't shippable — throw to roll the
        //     whole transaction back (no partial commit) and surface the
        //     transition's own status.
        const shippedKey = clientEventId ? `${clientEventId}:${u.id}:SHIPPED` : null;
        const t = await transition(
          {
            unitId: u.id,
            to: 'SHIPPED',
            eventType: 'SHIPPED',
            actorStaffId,
            station: 'SHIP',
            clientEventId: shippedKey ?? undefined,
            stockLedgerId: ledgerId ?? undefined,
            payload: {
              source: 'pack.ship',
              order_id: orderId,
              allocation_id: a.id,
              tracking_number: trackingNumber,
              carrier,
            },
          },
          client,
          orgId,
        );
        if (!t.ok) {
          throw new UnitTransitionError(t.status, u.id, t.from ?? null, t.error);
        }

        perUnit.push({
          unitId: u.id,
          allocationId: a.id,
          prevStatus: u.current_status,
          packedEventId: packedEv.rows[0]?.id ?? null,
          labeledEventId: labeledEv.rows[0]?.id ?? null,
          shippedEventId: t.eventId,
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
           station, activity_type, shipment_id, scan_ref, staff_id, packer_log_id, notes, metadata, organization_id
         )
         VALUES ('PACK', 'PACK_SHIPPED', $1, $2, $3, $4, $5, $6::jsonb, $7)`,
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
          ctx.organizationId,
        ],
      );

      // 8. Flip the order status last so observers see the events first.
      await client.query(
        `UPDATE orders SET status = 'shipped' WHERE id = $1 AND organization_id = $2`,
        [orderId, orgId],
      );

      return {
        ok: true as const,
        orderId,
        shipmentId: order.shipment_id ?? null,
        shipped_unit_count: perUnit.length,
        units: perUnit,
        packer_log_id: packerLog.rows[0]?.id ?? null,
      };
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: result.status });
    }

    // Formal audit-log row for the shipped order. recordAudit pulls actor/role/
    // ip/request-id from ctx + headers and never throws. The route already
    // writes per-unit SHIPPED inventory_events + a packer_logs row; this adds
    // the generic audit_logs spine the compliance dashboards key off.
    await recordAudit(pool, ctx, request, {
      source: 'pack.ship',
      action: AUDIT_ACTION.PACK_COMPLETED,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: orderId,
      method: 'manual',
      after: { status: 'shipped' },
      extra: {
        shipped_unit_count: result.shipped_unit_count,
        shipment_id: result.shipmentId,
        tracking_number: trackingNumber,
        carrier,
        packer_log_id: result.packer_log_id,
        unit_ids: result.units.map((u) => u.unitId),
      },
    });

    // Phase 1.4/1.5 fulfillment tail: tell the engine each unit was packed then
    // shipped so an enrolled+listed unit flows pack → ship → done. Fire-and-forget
    // AFTER the commit (tapWorkflow never throws and drops unenrolled units);
    // behind the flag. The two taps are awaited in order per unit: 'packed'
    // advances pack → ship, then 'shipped' (now parked at ship) advances ship →
    // done (the ship port is terminal/unrouted). expectNodeType keeps each a
    // no-op off its node, so a unit shipped without engine-listing can't be
    // false-advanced or blocked. Both are observer-only — the irreversible
    // carrier custody already happened in the committed transaction above; the
    // engine just records that the unit reached the terminal node.
    if (isUnifiedEngineFulfillmentTaps()) {
      after(async () => {
        for (const u of result.units) {
          await tapWorkflow({
            serialUnitId: u.unitId,
            event: 'packed',
            input: { shipmentId: result.shipmentId },
            staffId: actorStaffId,
            source: 'scan',
            orgId: ctx.organizationId,
            expectNodeType: 'pack',
          });
          await tapWorkflow({
            serialUnitId: u.unitId,
            event: 'shipped',
            input: { shipmentId: result.shipmentId, trackingNumber, carrier },
            staffId: actorStaffId,
            source: 'scan',
            orgId: ctx.organizationId,
            expectNodeType: 'ship',
          });
        }
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    // A unit that wasn't in a shippable state rolled the whole transaction
    // back — surface the transition's own status (404/409), not a 500. We do
    // NOT force-ship.
    if (err instanceof UnitTransitionError) {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          mismatches: [
            { unitId: err.unitId, reason: 'not in a shippable state', fromStatus: err.fromStatus },
          ],
        },
        { status: err.httpStatus },
      );
    }
    const message = err instanceof Error ? err.message : 'pack ship failed';
    console.error('[POST /api/pack/ship] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'packing.complete_order' });
