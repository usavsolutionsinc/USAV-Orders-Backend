import { NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseScannedUrl } from '@/lib/scan-resolver';
import { transition } from '@/lib/inventory/state-machine';

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
 * Permission: fba.stage_shipments.
 */
export const POST = withAuth(async (request, ctx) => {
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
    const result = await withTenantTransaction(ctx.organizationId, async (client) => {
      // 1. Confirm the FBA shipment item exists and grab its fnsku/sku.
      const itemQ = await client.query<{ id: number; fnsku: string | null; sku: string | null; status: string | null }>(
        `SELECT i.id, i.fnsku, f.sku, i.status::text AS status
           FROM fba_shipment_items i
           LEFT JOIN fba_fnskus f ON f.fnsku = i.fnsku AND f.organization_id = $2
          WHERE i.id = $1 AND i.organization_id = $2
          LIMIT 1`,
        [fbaShipmentItemId, ctx.organizationId],
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

      // 4+5. Transition unit → ALLOCATED if it's currently STOCKED, which also
      //    emits the ALLOCATED event atomically (guarded, replacing the former
      //    raw status UPDATE + manual event INSERT). Don't downgrade an
      //    already-PACKED/LABELED unit (defensive) — only STOCKED units move.
      const prevStatus = unit.current_status;
      let nextStatus = prevStatus;
      let eventId: number | null = null;
      if (prevStatus === 'STOCKED') {
        const key = clientEventId ? `${clientEventId}:fba-alloc:${unit.id}` : null;
        const t = await transition({
          unitId: unit.id,
          to: 'ALLOCATED',
          eventType: 'ALLOCATED',
          actorStaffId,
          station: 'PACK',
          clientEventId: key,
          expectedFrom: 'STOCKED',
          payload: {
            source: 'fba.link-unit',
            fba_shipment_item_id: fbaShipmentItemId,
            fnsku: item.fnsku,
          },
        }, client);
        // Throw (don't return) so a transition failure rolls back the
        // fba_shipment_item_units link inserted above — never commit a link
        // with the unit left un-allocated. Unreachable in practice (STOCKED→
        // ALLOCATED is a valid edge and the row is locked), but keeps the txn
        // all-or-nothing, symmetric with allocate.ts.
        if (!t.ok) throw new Error(`fba.link-unit: STOCKED→ALLOCATED failed for unit ${unit.id}: ${t.error}`);
        nextStatus = 'ALLOCATED';
        eventId = t.eventId;
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
}, { permission: 'fba.stage_shipments', feature: 'fba' });
