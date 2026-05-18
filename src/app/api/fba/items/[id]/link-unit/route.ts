import { NextResponse } from 'next/server';
import { transaction } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2FbaSerialLink } from '@/lib/feature-flags';
import { parseScannedUrl } from '@/lib/scan-resolver';

/**
 * POST /api/fba/items/[id]/link-unit
 *
 * Phase 6. Links a specific serialized unit to an FBA shipment item line.
 * For Tier-3 (serialized) FNSKUs only — Tier-1/2 lines remain pure
 * actual_qty counters and don't go through this endpoint.
 *
 * Single transaction:
 *   1. INSERT fba_shipment_item_units (idempotent via PK).
 *   2. UPDATE serial_units.current_status → ALLOCATED (FBA pack is the
 *      allocation moment for FBA-bound stock).
 *   3. INSERT inventory_events ALLOCATED with payload tagging this as
 *      an FBA allocation.
 *
 * Body:
 *   { scan?: string, serial_unit_id?: number, client_event_id?: string }
 *
 * The `scan` field accepts a raw serial OR a GS1 Digital Link URL.
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

  // /api/fba/items/[id]/link-unit
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const fbaShipmentItemId = Number(idStr);
  if (!Number.isFinite(fbaShipmentItemId) || fbaShipmentItemId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid item id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const scan = String(body?.scan || '').trim();
  const serialUnitIdRaw = Number(body?.serial_unit_id);
  const serialUnitIdInput =
    Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0 ? Math.floor(serialUnitIdRaw) : null;
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  if (!scan && !serialUnitIdInput) {
    return NextResponse.json(
      { ok: false, error: 'scan or serial_unit_id is required' },
      { status: 400 },
    );
  }

  let normalizedSerial: string | null = null;
  if (scan) {
    const url = parseScannedUrl(scan);
    normalizedSerial = url && url.type === 'unit' ? url.unitSerial.toUpperCase() : scan.toUpperCase();
  }

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await transaction(async (client) => {
      // 1. Confirm the FBA shipment item exists and grab its fnsku/sku.
      const itemQ = await client.query<{ id: number; fnsku: string | null; sku: string | null; status: string | null }>(
        `SELECT i.id, i.fnsku, f.sku, i.status::text AS status
           FROM fba_shipment_items i
           LEFT JOIN fba_fnskus f ON f.fnsku = i.fnsku
          WHERE i.id = $1
          LIMIT 1`,
        [fbaShipmentItemId],
      );
      const item = itemQ.rows[0];
      if (!item) return { ok: false as const, status: 404, error: 'fba_shipment_item not found' };

      // 2. Resolve the unit.
      const unitQ = serialUnitIdInput
        ? await client.query<{ id: number; sku: string | null; current_status: string }>(
            `SELECT id, sku, current_status::text AS current_status
               FROM serial_units WHERE id = $1 LIMIT 1 FOR UPDATE`,
            [serialUnitIdInput],
          )
        : await client.query<{ id: number; sku: string | null; current_status: string }>(
            `SELECT id, sku, current_status::text AS current_status
               FROM serial_units WHERE normalized_serial = $1 LIMIT 1 FOR UPDATE`,
            [normalizedSerial],
          );
      const unit = unitQ.rows[0];
      if (!unit) return { ok: false as const, status: 404, error: 'serial_units row not found' };

      // 3. Link. Composite PK gives idempotency for free.
      const link = await client.query<{ fba_shipment_item_id: number; serial_unit_id: number }>(
        `INSERT INTO fba_shipment_item_units (
           fba_shipment_item_id, serial_unit_id, added_by_staff_id
         )
         VALUES ($1, $2, $3)
         ON CONFLICT (fba_shipment_item_id, serial_unit_id) DO NOTHING
         RETURNING fba_shipment_item_id, serial_unit_id`,
        [fbaShipmentItemId, unit.id, actorStaffId],
      );
      const created = link.rows.length > 0;

      // 4. Transition unit → ALLOCATED if it's currently STOCKED. Don't
      //    downgrade an already-PACKED/LABELED unit (defensive).
      const prevStatus = unit.current_status;
      let nextStatus = prevStatus;
      if (prevStatus === 'STOCKED') {
        await client.query(
          `UPDATE serial_units
              SET current_status = 'ALLOCATED'::serial_status_enum,
                  updated_at = NOW()
            WHERE id = $1`,
          [unit.id],
        );
        nextStatus = 'ALLOCATED';
      }

      // 5. Emit ALLOCATED event (only when status actually changed —
      //    idempotent inserts are fine via clientEventId anyway).
      let eventId: number | null = null;
      if (nextStatus !== prevStatus) {
        const key = clientEventId ? `${clientEventId}:fba-alloc:${unit.id}` : null;
        const ev = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
             event_type, actor_staff_id, station,
             serial_unit_id, sku,
             prev_status, next_status,
             client_event_id, payload
           )
           VALUES ('ALLOCATED', $1, 'PACK',
                   $2, $3,
                   $4, $5,
                   $6, $7::jsonb)
           ON CONFLICT (client_event_id) DO NOTHING
           RETURNING id`,
          [
            actorStaffId, unit.id, unit.sku ?? item.sku, prevStatus, nextStatus, key,
            JSON.stringify({
              source: 'fba.link-unit',
              fba_shipment_item_id: fbaShipmentItemId,
              fnsku: item.fnsku,
            }),
          ],
        );
        eventId = ev.rows[0]?.id ?? null;
      }

      return {
        ok: true as const,
        created,
        fbaShipmentItemId,
        serialUnitId: unit.id,
        prevStatus,
        nextStatus,
        inventoryEventId: eventId,
      };
    });

    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fba link-unit failed';
    console.error('[POST /api/fba/items/[id]/link-unit] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'fba.stage_shipments' });
