import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import {
  recordInventoryEvent,
  type InventoryEventType,
  type InventoryEventStation,
} from '@/lib/inventory/events';
import { applyTransition } from '@/lib/workflow/applyTransition';
import { isUnifiedEngineApplyTransition } from '@/lib/feature-flags';
import type { SerialState } from '@/lib/inventory/state-machine';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

const ALLOWED_EVENT_TYPES: ReadonlySet<InventoryEventType> = new Set([
  'TEST_START',
  'TEST_PASS',
  'TEST_FAIL',
  'NOTE',
  'SCRAPPED',
  'RETURNED',
]);

// Map event_type → receiving_lines.workflow_status when the lifecycle
// of the line should advance. Lines that aren't being tested (e.g. NOTE)
// stay where they are.
const WORKFLOW_FOR_EVENT: Partial<Record<InventoryEventType, string>> = {
  TEST_START: 'IN_TEST',
  TEST_PASS:  'PASSED',
  TEST_FAIL:  'FAILED',
  SCRAPPED:   'SCRAP',
  RETURNED:   'RTV',
};

// Map event_type → serial_units.current_status when a serial is in scope.
const SERIAL_STATUS_FOR_EVENT: Partial<Record<InventoryEventType, string>> = {
  TEST_START: 'RECEIVED',  // testing has begun; lifecycle technically RECEIVED until passed
  TEST_PASS:  'TESTED',
  TEST_FAIL:  'TESTED',    // tested-and-failed is still "tested" — disposition decides RMA/SCRAP
  SCRAPPED:   'SCRAPPED',
  RETURNED:   'RETURNED',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.mark_received');
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

    const eventTypeRaw = String(body?.event_type || '').trim().toUpperCase() as InventoryEventType;
    if (!ALLOWED_EVENT_TYPES.has(eventTypeRaw)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported event_type. Allowed: ${Array.from(ALLOWED_EVENT_TYPES).join(', ')}`,
        },
        { status: 400 },
      );
    }
    const eventType: InventoryEventType = eventTypeRaw;

    const staffIdRaw = Number(body?.staff_id ?? body?.staffId);
    const staffId =
      Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;

    const serialUnitIdRaw = Number(body?.serial_unit_id);
    const serialUnitId =
      Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0
        ? Math.floor(serialUnitIdRaw)
        : null;

    const notes = String(body?.notes || '').trim() || null;
    const qaStatus = String(body?.qa_status || '').trim() || null;
    const dispositionCode = String(body?.disposition_code || '').trim() || null;
    const conditionGrade = String(body?.condition_grade || '').trim() || null;
    const clientEventId = String(body?.client_event_id || '').trim() || null;
    const scanToken = String(body?.scan_token || '').trim() || null;
    const stationRaw = String(body?.station || '').trim().toUpperCase();
    const station: InventoryEventStation =
      stationRaw === 'MOBILE' || stationRaw === 'TECH' || stationRaw === 'RECEIVING'
        ? (stationRaw as InventoryEventStation)
        : 'MOBILE';

    // Tenant scope. `pool` is the BYPASSRLS owner connection, so every read/write
    // below carries an explicit organization_id predicate — a cross-tenant id
    // reads as not-found rather than mutating another org's row.
    const orgId = ctx.organizationId;

    // Load the line to capture prev state + sku + receiving_id (org-scoped).
    const lineRes = await tenantQuery<{
      id: number;
      receiving_id: number | null;
      sku: string | null;
      workflow_status: string | null;
    }>(
      orgId,
      `SELECT id, receiving_id, sku, workflow_status::text AS workflow_status
       FROM receiving_lines WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [lineId, orgId],
    );
    const line = lineRes.rows[0];
    if (!line) {
      return NextResponse.json(
        { success: false, error: `receiving_line ${lineId} not found` },
        { status: 404 },
      );
    }

    // Capture prior status of the serial (if any) for the event diff (org-scoped).
    let priorSerialStatus: string | null = null;
    if (serialUnitId) {
      const sr = await tenantQuery<{ current_status: string }>(
        orgId,
        `SELECT current_status::text AS current_status
           FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [serialUnitId, orgId],
      );
      priorSerialStatus = sr.rows[0]?.current_status ?? null;
    }

    const nextWorkflow = WORKFLOW_FOR_EVENT[eventType] ?? null;
    const nextSerialStatus = SERIAL_STATUS_FOR_EVENT[eventType] ?? null;

    // ─── Update line metadata + workflow_status (org-scoped) ────────────────
    if (nextWorkflow || qaStatus || dispositionCode || conditionGrade) {
      await tenantQuery(
        orgId,
        `UPDATE receiving_lines
         SET workflow_status  = COALESCE($2::inbound_workflow_status_enum, workflow_status),
             qa_status        = COALESCE($3, qa_status),
             disposition_code = COALESCE($4, disposition_code),
             condition_grade  = COALESCE($5, condition_grade),
             notes            = COALESCE($6, notes),
             updated_at       = NOW()
         WHERE id = $1 AND organization_id = $7`,
        [lineId, nextWorkflow, qaStatus, dispositionCode, conditionGrade, notes, orgId],
      );
    }

    // ─── Update serial_units.current_status + the lifecycle event ───────────
    //
    // The serial status change is the dual-spine drift this route used to cause:
    // a raw, unguarded UPDATE plus a separate, non-atomic inventory_event. Behind
    // UNIFIED_ENGINE_APPLY_TRANSITION, route it through the guarded chokepoint
    // (applyTransition) — guard + atomic event in one tx — with skipTap, since
    // recordTestVerdict is the canonical tapper for test verdicts (a second tap
    // here would be redundant). The chokepoint writes the inventory_event itself
    // (receiving_line_id + payload preserved), so we don't write a second one.
    //
    //   - flag ON  + serial in scope + guard allows → chokepoint owns the event.
    //   - flag ON  + guard declines (e.g. RTV RETURNED from a receiving state is
    //     not modeled) → log + fall back to the legacy raw write + event (parity
    //     net; surfaces which transitions still need an allow-list edge).
    //   - flag OFF, line-only (NOTE / no serial) → legacy raw write + event,
    //     now org-scoped. Byte-identical to before for legitimate traffic.
    const useChokepoint = isUnifiedEngineApplyTransition();
    const eventPayload = {
      qa_status: qaStatus,
      disposition_code: dispositionCode,
      condition_grade: conditionGrade,
    };
    let event!: { id: number } | Awaited<ReturnType<typeof recordInventoryEvent>>;
    let serialHandledByChokepoint = false;

    if (serialUnitId && nextSerialStatus && useChokepoint) {
      const applied = await applyTransition({
        unitId: serialUnitId,
        to: nextSerialStatus as SerialState,
        eventType,
        actorStaffId: staffId,
        station,
        clientEventId,
        notes,
        payload: eventPayload,
        receivingId: line.receiving_id,
        receivingLineId: lineId,
        scanToken,
        binId: null, // a line-status verdict moves no bin — keep the event bin_id null
        sku: line.sku,
        orgId,
        skipTap: true,
      });
      if (applied.ok) {
        // The chokepoint already wrote the (guarded) serial status + atomic event.
        event = { id: applied.eventId };
        serialHandledByChokepoint = true;
      } else {
        console.warn(
          `[receiving/lines/status] chokepoint declined serial ${serialUnitId} ` +
            `${priorSerialStatus ?? '?'}→${nextSerialStatus} (${applied.error}); falling back to raw write`,
        );
      }
    }

    if (!serialHandledByChokepoint) {
      // Legacy/line-only path: raw serial UPDATE (org-scoped) when in scope, then
      // the single inventory_event covering this line+serial action.
      if (serialUnitId && nextSerialStatus) {
        await pool.query(
          `UPDATE serial_units
             SET current_status = $2::serial_status_enum, updated_at = NOW()
           WHERE id = $1 AND organization_id = $3`,
          [serialUnitId, nextSerialStatus, orgId],
        );
      }
      event = await recordInventoryEvent(
        {
          event_type: eventType,
          actor_staff_id: staffId,
          station,
          receiving_id: line.receiving_id,
          receiving_line_id: lineId,
          serial_unit_id: serialUnitId,
          sku: line.sku,
          prev_status: priorSerialStatus ?? line.workflow_status ?? null,
          next_status: nextSerialStatus ?? nextWorkflow ?? null,
          scan_token: scanToken,
          client_event_id: clientEventId,
          notes,
          payload: eventPayload,
        },
        undefined,
        orgId,
      );
    }

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
        if (line.receiving_id != null) {
          await publishReceivingLogChanged({
            organizationId: ctx.organizationId,
            action: 'update',
            rowId: String(line.receiving_id),
            source: 'receiving.lines.status',
          });
        }
      } catch (err) {
        console.warn('receiving/lines/status: cache/realtime failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      event,
      line_id: lineId,
      workflow_status: nextWorkflow ?? line.workflow_status,
      serial_status: nextSerialStatus ?? priorSerialStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update status';
    console.error('receiving/lines/status POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
