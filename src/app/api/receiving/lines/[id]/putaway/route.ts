import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import {
  recordInventoryEvent,
  type InventoryEventStation,
} from '@/lib/inventory/events';
import { transition } from '@/lib/inventory/state-machine';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * Stash all (or some) units of a receiving line into a physical bin.
 *
 *   POST /api/receiving/lines/:id/putaway
 *   { bin_barcode | bin_id, qty?, serial_unit_id?, staff_id?,
 *     client_event_id?, scan_token?, notes? }
 *
 * Writes:
 *   - inventory_events PUTAWAY (per unit; idempotent on client_event_id:N)
 *   - serial_units.current_location + current_status='STOCKED' (when serial)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.bin_assign');
    if (gate.denied) return gate.denied;
    const ctx = gate.ctx;
    const { id: idRaw } = await params;
    const lineId = Number(idRaw);
    if (!Number.isFinite(lineId) || lineId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid line id is required' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));

    const binBarcode = String(body?.bin_barcode || '').trim();
    const binIdRaw = Number(body?.bin_id);
    const binIdFromBody =
      Number.isFinite(binIdRaw) && binIdRaw > 0 ? Math.floor(binIdRaw) : null;
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

    if (!binBarcode && !binIdFromBody) {
      return NextResponse.json(
        { success: false, error: 'bin_barcode or bin_id is required' },
        { status: 400 },
      );
    }

    // GUC-wrapped: receiving_lines + serial_units are FORCEd, so the whole
    // putaway (bin/line lookups, the guarded status write, the location move, and
    // the per-unit events) runs on the app_tenant pool under app.current_org so
    // RLS isolates it AND the status flip + event commit atomically (the old code
    // wrote status on the raw pool, then events separately — non-atomic).
    const orgId = ctx.organizationId;
    type BinRow = { id: number; name: string; barcode: string | null };
    type PutawayResult =
      | { ok: false; status: number; error: string }
      | { ok: true; bin: BinRow; receivingId: number | null; events: Array<{ id: number }> };

    const result = await withTenantTransaction<PutawayResult>(orgId, async (client) => {
      // Resolve the bin (org-scoped — locations is tenant-owned).
      let bin: BinRow | null = null;
      if (binIdFromBody) {
        const r = await client.query<BinRow>(
          `SELECT id, name, barcode FROM locations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [binIdFromBody, orgId],
        );
        bin = r.rows[0] ?? null;
      } else {
        const r = await client.query<BinRow>(
          `SELECT id, name, barcode FROM locations
            WHERE (barcode = $1 OR LOWER(name) = LOWER($1)) AND organization_id = $2
            LIMIT 1`,
          [binBarcode, orgId],
        );
        bin = r.rows[0] ?? null;
      }
      if (!bin) {
        return { ok: false, status: 404, error: `Bin not found: ${binBarcode || binIdFromBody}` };
      }

      // Load line state for receiving_id + sku (org-scoped — receiving_lines is FORCEd).
      const lineRes = await client.query<{ id: number; receiving_id: number | null; sku: string | null }>(
        `SELECT id, receiving_id, sku FROM receiving_lines WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [lineId, orgId],
      );
      const line = lineRes.rows[0];
      if (!line) {
        return { ok: false, status: 404, error: `receiving_line ${lineId} not found` };
      }

      // Find prior bin for this line/serial (most recent PUTAWAY or MOVED event).
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
      const prevBinId = priorBinRes.rows[0]?.bin_id ?? null;

      const events: Array<{ id: number }> = [];

      if (serialUnitId) {
        // Putaway = "ensure STOCKED + move to bin". Lock + read the unit's status:
        // the status flip to STOCKED only fires when it is NOT already there, so a
        // re-putaway / bin-move of an already-STOCKED unit stays idempotent
        // (transition() rejects STOCKED→STOCKED as an identity transition).
        const uq = await client.query<{ current_status: string }>(
          `SELECT current_status::text AS current_status FROM serial_units
            WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
          [serialUnitId, orgId],
        );
        const unit = uq.rows[0];
        if (!unit) {
          return { ok: false, status: 404, error: `serial_unit ${serialUnitId} not found` };
        }

        const firstPayload = { qty: 1, unit_index: 1, of_qty: qty, bin_name: bin.name };
        const firstEventKey = clientEventId ? `${clientEventId}:put-1` : null;
        if (unit.current_status !== 'STOCKED') {
          // Guarded status write + the canonical PUTAWAY event (SoT: never raw
          // current_status). transition() emits the event atomically on this client.
          const tr = await transition(
            {
              unitId: serialUnitId,
              to: 'STOCKED',
              eventType: 'PUTAWAY',
              actorStaffId: staffId,
              station,
              binId: bin.id,
              prevBinId,
              receivingId: line.receiving_id,
              receivingLineId: line.id,
              scanToken,
              clientEventId: firstEventKey,
              notes,
              payload: firstPayload,
            },
            client,
            orgId,
          );
          if (!tr.ok) {
            return { ok: false, status: tr.status, error: `putaway ${unit.current_status}→STOCKED: ${tr.error}` };
          }
          events.push({ id: tr.eventId });
        } else {
          // Already STOCKED → location-only move; emit a PUTAWAY event (no status change).
          const ev = await recordInventoryEvent(
            {
              event_type: 'PUTAWAY',
              actor_staff_id: staffId,
              station,
              receiving_id: line.receiving_id,
              receiving_line_id: line.id,
              serial_unit_id: serialUnitId,
              sku: line.sku,
              bin_id: bin.id,
              prev_bin_id: prevBinId,
              prev_status: 'STOCKED',
              next_status: 'STOCKED',
              scan_token: scanToken,
              client_event_id: firstEventKey,
              notes,
              payload: firstPayload,
            },
            client,
          );
          events.push({ id: ev.id });
        }

        // Apply the location move (transition() writes status only).
        await client.query(
          `UPDATE serial_units SET current_location = $1, updated_at = NOW()
            WHERE id = $2 AND organization_id = $3`,
          [bin.name, serialUnitId, orgId],
        );

        // Preserve the per-qty timeline for the (rare) qty>1 serialized case.
        for (let i = 1; i < qty; i++) {
          const ev = await recordInventoryEvent(
            {
              event_type: 'PUTAWAY',
              actor_staff_id: staffId,
              station,
              receiving_id: line.receiving_id,
              receiving_line_id: line.id,
              serial_unit_id: serialUnitId,
              sku: line.sku,
              bin_id: bin.id,
              prev_bin_id: prevBinId,
              prev_status: null,
              next_status: 'STOCKED',
              scan_token: scanToken,
              client_event_id: clientEventId ? `${clientEventId}:put-${i + 1}` : null,
              notes,
              payload: { qty: 1, unit_index: i + 1, of_qty: qty, bin_name: bin.name },
            },
            client,
          );
          events.push({ id: ev.id });
        }
      } else {
        // Non-serialized: one PUTAWAY event per unit, no status/location write.
        for (let i = 0; i < qty; i++) {
          const ev = await recordInventoryEvent(
            {
              event_type: 'PUTAWAY',
              actor_staff_id: staffId,
              station,
              receiving_id: line.receiving_id,
              receiving_line_id: line.id,
              serial_unit_id: null,
              sku: line.sku,
              bin_id: bin.id,
              prev_bin_id: prevBinId,
              prev_status: null,
              next_status: null,
              scan_token: scanToken,
              client_event_id: clientEventId ? `${clientEventId}:put-${i + 1}` : null,
              notes,
              payload: { qty: 1, unit_index: i + 1, of_qty: qty, bin_name: bin.name },
            },
            client,
          );
          events.push({ id: ev.id });
        }
      }

      return { ok: true, bin, receivingId: line.receiving_id, events };
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    const { bin, events } = result;

    // Audit the bin assignment (the per-unit PUTAWAY inventory_events are the
    // lifecycle spine; the audit_log operator trail was missing here). Runs on
    // the BYPASSRLS pool outside the tenant tx; org is stamped from ctx.
    await recordAudit(pool, ctx, request, {
      source: 'receiving-station',
      action: AUDIT_ACTION.SKU_STOCK_BIN_ASSIGN,
      entityType: AUDIT_ENTITY.RECEIVING_LINE,
      entityId: lineId,
      method: 'scan',
      scanRef: scanToken,
      binCode: bin.name,
      after: { bin_id: bin.id, bin_name: bin.name },
      extra: {
        serial_unit_id: serialUnitId,
        qty,
        event_count: events.length,
      },
    });

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-lines', 'sku-stock', 'serial-units']);
        if (result.receivingId != null) {
          await publishReceivingLogChanged({
            organizationId: ctx.organizationId,
            action: 'update',
            rowId: String(result.receivingId),
            source: 'receiving.lines.putaway',
          });
        }
      } catch (err) {
        console.warn('receiving/lines/putaway: cache/realtime failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      line_id: lineId,
      bin: { id: bin.id, name: bin.name, barcode: bin.barcode },
      qty,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to putaway';
    console.error('receiving/lines/putaway POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
