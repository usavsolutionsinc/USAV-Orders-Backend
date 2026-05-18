import { NextResponse } from 'next/server';
import { transaction } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2FbaSerialLink } from '@/lib/feature-flags';

/**
 * POST /api/fba/shipments/[id]/ship-units
 *
 * Phase 6 companion to /api/pack/ship. For every serial_unit linked to
 * any item in this FBA shipment via fba_shipment_item_units, emit the
 * SHIPPED-lifecycle transition (PACKED → LABELED → SHIPPED inventory
 * events + sku_stock_ledger decrement). The existing
 * /api/fba/shipments/close endpoint continues to handle the FBA-shipment
 * state machine for non-serialized lines; this endpoint adds the
 * per-unit decrement that the legacy close never performed.
 *
 * Body:
 *   { client_event_id?: string }
 *
 * Single transaction. Idempotent: re-running after success is a no-op
 * because units are already SHIPPED and per-unit clientEventId suffixes
 * collide on retry.
 *
 * Gated by INVENTORY_V2_FBA_SERIAL_LINK; off-flag returns 503.
 * Permission: fba.stage_shipments.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2FbaSerialLink()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_FBA_SERIAL_LINK flag is OFF', flag: 'INVENTORY_V2_FBA_SERIAL_LINK' },
      { status: 503 },
    );
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const fbaShipmentId = Number(idStr);
  if (!Number.isFinite(fbaShipmentId) || fbaShipmentId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid shipment id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await transaction(async (client) => {
      // 1. Resolve all linked units for this shipment.
      const linksQ = await client.query<{
        serial_unit_id: number;
        fba_shipment_item_id: number;
        sku: string | null;
        current_status: string;
      }>(
        `SELECT u.serial_unit_id, u.fba_shipment_item_id,
                COALESCE(su.sku, f.sku) AS sku,
                su.current_status::text AS current_status
           FROM fba_shipment_item_units u
           JOIN fba_shipment_items i ON i.id = u.fba_shipment_item_id
           JOIN serial_units su      ON su.id = u.serial_unit_id
           LEFT JOIN fba_fnskus f    ON f.fnsku = i.fnsku
          WHERE i.shipment_id = $1
            AND su.current_status <> 'SHIPPED'
          ORDER BY u.serial_unit_id ASC
          FOR UPDATE OF su`,
        [fbaShipmentId],
      );
      const links = linksQ.rows;
      if (links.length === 0) {
        return { ok: true as const, fbaShipmentId, shipped_unit_count: 0, units: [] };
      }

      const perUnit: Array<{
        unitId: number;
        prevStatus: string;
        packedEventId: number | null;
        labeledEventId: number | null;
        shippedEventId: number | null;
        ledgerId: number | null;
      }> = [];

      for (let i = 0; i < links.length; i++) {
        const link = links[i];

        // Emit PACKED + LABELED so the timeline is intact for FBA-routed
        // units. They didn't go through the order-pack flow, but the
        // lifecycle should still record the transitions.
        const packedKey = clientEventId ? `${clientEventId}:fba:${link.serial_unit_id}:PACKED` : null;
        const packedEv = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
             event_type, actor_staff_id, station, serial_unit_id, sku,
             prev_status, next_status, client_event_id, payload
           )
           VALUES ('PACKED', $1, 'PACK', $2, $3, $4, 'PACKED', $5, $6::jsonb)
           ON CONFLICT (client_event_id) DO NOTHING
           RETURNING id`,
          [
            actorStaffId, link.serial_unit_id, link.sku, link.current_status, packedKey,
            JSON.stringify({
              source: 'fba.ship-units',
              fba_shipment_id: fbaShipmentId,
              fba_shipment_item_id: link.fba_shipment_item_id,
              ordinal: i + 1,
            }),
          ],
        );

        const labeledKey = clientEventId ? `${clientEventId}:fba:${link.serial_unit_id}:LABELED` : null;
        const labeledEv = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
             event_type, actor_staff_id, station, serial_unit_id, sku,
             prev_status, next_status, client_event_id, payload
           )
           VALUES ('LABELED', $1, 'PACK', $2, $3, 'PACKED', 'LABELED', $4, $5::jsonb)
           ON CONFLICT (client_event_id) DO NOTHING
           RETURNING id`,
          [
            actorStaffId, link.serial_unit_id, link.sku, labeledKey,
            JSON.stringify({
              source: 'fba.ship-units',
              fba_shipment_id: fbaShipmentId,
              fba_shipment_item_id: link.fba_shipment_item_id,
            }),
          ],
        );

        // sku_stock_ledger — the FBA decrement.
        let ledgerId: number | null = null;
        if (link.sku) {
          const ledger = await client.query<{ id: number }>(
            `INSERT INTO sku_stock_ledger (
               sku, delta, reason, dimension, staff_id,
               ref_serial_unit_id, notes
             )
             VALUES ($1, -1, 'SOLD', 'WAREHOUSE', $2, $3, $4)
             RETURNING id`,
            [
              link.sku, actorStaffId, link.serial_unit_id,
              `fba.ship-units shipment=${fbaShipmentId} item=${link.fba_shipment_item_id}`,
            ],
          );
          ledgerId = ledger.rows[0]?.id ?? null;
        }

        // Unit → SHIPPED.
        await client.query(
          `UPDATE serial_units
              SET current_status = 'SHIPPED'::serial_status_enum,
                  updated_at = NOW()
            WHERE id = $1`,
          [link.serial_unit_id],
        );

        const shippedKey = clientEventId ? `${clientEventId}:fba:${link.serial_unit_id}:SHIPPED` : null;
        const shippedEv = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
             event_type, actor_staff_id, station, serial_unit_id, sku,
             prev_status, next_status, stock_ledger_id, client_event_id, payload
           )
           VALUES ('SHIPPED', $1, 'SHIP', $2, $3, 'LABELED', 'SHIPPED', $4, $5, $6::jsonb)
           ON CONFLICT (client_event_id) DO NOTHING
           RETURNING id`,
          [
            actorStaffId, link.serial_unit_id, link.sku, ledgerId, shippedKey,
            JSON.stringify({
              source: 'fba.ship-units',
              fba_shipment_id: fbaShipmentId,
              fba_shipment_item_id: link.fba_shipment_item_id,
            }),
          ],
        );

        perUnit.push({
          unitId: link.serial_unit_id,
          prevStatus: link.current_status,
          packedEventId: packedEv.rows[0]?.id ?? null,
          labeledEventId: labeledEv.rows[0]?.id ?? null,
          shippedEventId: shippedEv.rows[0]?.id ?? null,
          ledgerId,
        });
      }

      return {
        ok: true as const,
        fbaShipmentId,
        shipped_unit_count: perUnit.length,
        units: perUnit,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fba ship-units failed';
    console.error('[POST /api/fba/shipments/[id]/ship-units] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'fba.stage_shipments' });
