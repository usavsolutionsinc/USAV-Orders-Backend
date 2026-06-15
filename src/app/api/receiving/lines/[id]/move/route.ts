import { NextRequest, NextResponse, after } from 'next/server';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import {
  recordInventoryEvent,
  type InventoryEventStation,
} from '@/lib/inventory/events';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { withTenantTransaction } from '@/lib/tenancy/db';

/**
 * Move units between bins. Differs from /putaway in that the prior bin is
 * captured explicitly so the timeline shows the from→to transition.
 *
 *   POST /api/receiving/lines/:id/move
 *   { to_bin_barcode | to_bin_id, from_bin_barcode?, qty?, serial_unit_id?, … }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.bin_assign');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id: idRaw } = await params;
    const lineId = Number(idRaw);
    if (!Number.isFinite(lineId) || lineId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid line id is required' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));

    const toBarcode = String(body?.to_bin_barcode || '').trim();
    const toIdRaw = Number(body?.to_bin_id);
    const toIdFromBody =
      Number.isFinite(toIdRaw) && toIdRaw > 0 ? Math.floor(toIdRaw) : null;

    const fromBarcode = String(body?.from_bin_barcode || '').trim();
    const fromIdRaw = Number(body?.from_bin_id);
    const fromIdFromBody =
      Number.isFinite(fromIdRaw) && fromIdRaw > 0 ? Math.floor(fromIdRaw) : null;

    const qtyRaw = Number(body?.qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1;

    const serialUnitIdRaw = Number(body?.serial_unit_id);
    const serialUnitId =
      Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0
        ? Math.floor(serialUnitIdRaw)
        : null;

    const staffIdRaw = Number(body?.staff_id ?? body?.staffId);
    const staffId =
      Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;

    const notes = String(body?.notes || '').trim() || null;
    const clientEventId = String(body?.client_event_id || '').trim() || null;
    const scanToken = String(body?.scan_token || '').trim() || null;
    const stationRaw = String(body?.station || '').trim().toUpperCase();
    const station: InventoryEventStation =
      stationRaw === 'TECH' || stationRaw === 'RECEIVING'
        ? (stationRaw as InventoryEventStation)
        : 'MOBILE';

    if (!toBarcode && !toIdFromBody) {
      return NextResponse.json(
        { success: false, error: 'to_bin_barcode or to_bin_id is required' },
        { status: 400 },
      );
    }

    type BinRow = { id: number; name: string; barcode: string | null };

    // All reads/writes run inside one tenant transaction so the org GUC is set
    // for the RLS backstop and every statement carries an explicit
    // organization_id predicate. A NotFound is thrown as a tagged error and
    // mapped back to a 404 below (preserving the original response shapes).
    type NotFound = { __notFound: true; status: number; error: string };
    const isNotFound = (v: unknown): v is NotFound =>
      typeof v === 'object' && v != null && (v as { __notFound?: boolean }).__notFound === true;

    const txResult = await withTenantTransaction(orgId, async (client) => {
      async function resolveBin(
        barcode: string,
        id: number | null,
      ): Promise<BinRow | null> {
        if (id) {
          const r = await client.query<BinRow>(
            `SELECT id, name, barcode FROM locations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
            [id, orgId],
          );
          return r.rows[0] ?? null;
        }
        if (barcode) {
          const r = await client.query<BinRow>(
            `SELECT id, name, barcode FROM locations
             WHERE (barcode = $1 OR LOWER(name) = LOWER($1))
               AND organization_id = $2
             LIMIT 1`,
            [barcode, orgId],
          );
          return r.rows[0] ?? null;
        }
        return null;
      }

      const toBin = await resolveBin(toBarcode, toIdFromBody);
      if (!toBin) {
        return {
          __notFound: true as const,
          status: 404,
          error: `Target bin not found: ${toBarcode || toIdFromBody}`,
        } satisfies NotFound;
      }

      let fromBin: BinRow | null = null;
      if (fromBarcode || fromIdFromBody) {
        fromBin = await resolveBin(fromBarcode, fromIdFromBody);
      }
      // Fall back to last known bin if not specified.
      if (!fromBin) {
        const priorBinRes = await client.query<{ bin_id: number | null }>(
          `SELECT bin_id FROM inventory_events
           WHERE event_type IN ('PUTAWAY','MOVED')
             AND organization_id = $3
             AND (
               ($1::int IS NOT NULL AND serial_unit_id = $1)
               OR ($1::int IS NULL AND serial_unit_id IS NULL AND receiving_line_id = $2)
             )
           ORDER BY occurred_at DESC, id DESC
           LIMIT 1`,
          [serialUnitId, lineId, orgId],
        );
        const prevId = priorBinRes.rows[0]?.bin_id ?? null;
        if (prevId) {
          const r = await client.query<BinRow>(
            `SELECT id, name, barcode FROM locations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
            [prevId, orgId],
          );
          fromBin = r.rows[0] ?? null;
        }
      }

      const lineRes = await client.query<{
        id: number;
        receiving_id: number | null;
        sku: string | null;
      }>(
        `SELECT id, receiving_id, sku FROM receiving_lines WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [lineId, orgId],
      );
      const line = lineRes.rows[0];
      if (!line) {
        return {
          __notFound: true as const,
          status: 404,
          error: `receiving_line ${lineId} not found`,
        } satisfies NotFound;
      }

      if (serialUnitId) {
        await client.query(
          `UPDATE serial_units
           SET current_location = $2, updated_at = NOW()
           WHERE id = $1 AND organization_id = $3`,
          [serialUnitId, toBin.name, orgId],
        );
      }

      const events: Array<{ id: number }> = [];
      for (let i = 0; i < qty; i++) {
        const ev = await recordInventoryEvent(
          {
            event_type: 'MOVED',
            actor_staff_id: staffId,
            station,
            receiving_id: line.receiving_id,
            receiving_line_id: line.id,
            serial_unit_id: serialUnitId,
            sku: line.sku,
            bin_id: toBin.id,
            prev_bin_id: fromBin?.id ?? null,
            scan_token: scanToken,
            client_event_id: clientEventId ? `${clientEventId}:move-${i + 1}` : null,
            notes,
            payload: {
              qty: 1,
              unit_index: i + 1,
              of_qty: qty,
              from_bin: fromBin?.name ?? null,
              to_bin: toBin.name,
            },
          },
          client,
          orgId,
        );
        events.push({ id: ev.id });
      }

      return { toBin, fromBin, events };
    });

    if (isNotFound(txResult)) {
      return NextResponse.json(
        { success: false, error: txResult.error },
        { status: txResult.status },
      );
    }

    const { toBin, fromBin, events } = txResult;

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-lines', 'sku-stock', 'serial-units']);
      } catch (err) {
        console.warn('receiving/lines/move: cache invalidation failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      line_id: lineId,
      from_bin: fromBin
        ? { id: fromBin.id, name: fromBin.name, barcode: fromBin.barcode }
        : null,
      to_bin: { id: toBin.id, name: toBin.name, barcode: toBin.barcode },
      qty,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to move';
    console.error('receiving/lines/move POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
