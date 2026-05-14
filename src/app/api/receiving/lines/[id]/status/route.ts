import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import {
  recordInventoryEvent,
  type InventoryEventType,
  type InventoryEventStation,
} from '@/lib/inventory/events';

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

    // Load the line to capture prev state + sku + receiving_id.
    const lineRes = await pool.query<{
      id: number;
      receiving_id: number | null;
      sku: string | null;
      workflow_status: string | null;
    }>(
      `SELECT id, receiving_id, sku, workflow_status::text AS workflow_status
       FROM receiving_lines WHERE id = $1 LIMIT 1`,
      [lineId],
    );
    const line = lineRes.rows[0];
    if (!line) {
      return NextResponse.json(
        { success: false, error: `receiving_line ${lineId} not found` },
        { status: 404 },
      );
    }

    // Capture prior status of the serial (if any) for the event diff.
    let priorSerialStatus: string | null = null;
    if (serialUnitId) {
      const sr = await pool.query<{ current_status: string }>(
        `SELECT current_status::text AS current_status FROM serial_units WHERE id = $1 LIMIT 1`,
        [serialUnitId],
      );
      priorSerialStatus = sr.rows[0]?.current_status ?? null;
    }

    const nextWorkflow = WORKFLOW_FOR_EVENT[eventType] ?? null;
    const nextSerialStatus = SERIAL_STATUS_FOR_EVENT[eventType] ?? null;

    // ─── Update line metadata + workflow_status ─────────────────────────────
    if (nextWorkflow || qaStatus || dispositionCode || conditionGrade) {
      await pool.query(
        `UPDATE receiving_lines
         SET workflow_status  = COALESCE($2::inbound_workflow_status_enum, workflow_status),
             qa_status        = COALESCE($3, qa_status),
             disposition_code = COALESCE($4, disposition_code),
             condition_grade  = COALESCE($5, condition_grade),
             notes            = COALESCE($6, notes),
             updated_at       = NOW()
         WHERE id = $1`,
        [lineId, nextWorkflow, qaStatus, dispositionCode, conditionGrade, notes],
      );
    }

    // ─── Update serial_units.current_status when in scope ───────────────────
    if (serialUnitId && nextSerialStatus) {
      await pool.query(
        `UPDATE serial_units
         SET current_status = $2::serial_status_enum,
             updated_at = NOW()
         WHERE id = $1`,
        [serialUnitId, nextSerialStatus],
      );
    }

    // ─── Write the lifecycle event ──────────────────────────────────────────
    const event = await recordInventoryEvent({
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
      payload: {
        qa_status: qaStatus,
        disposition_code: dispositionCode,
        condition_grade: conditionGrade,
      },
    });

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
        if (line.receiving_id != null) {
          await publishReceivingLogChanged({
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
