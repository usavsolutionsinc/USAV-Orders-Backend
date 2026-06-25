/**
 * POST /api/receiving/lines/[id]/advance
 *
 * Manual, n8n-style lifecycle advance for a receiving line. Drives the line
 * through the coarse receiving lifecycle (INCOMING → SCANNED → UNBOXED →
 * RECEIVED) by hand — from the studio / the line detail — recording a NOTE on
 * the inventory_events spine so the move is auditable and the History timeline
 * shows it. Routes through the guarded transitionReceivingLine() chokepoint
 * (idempotent via client_event_id; org-scoped). Reuses the existing
 * `receiving.mark_received` permission — no new permission minted.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { transitionReceivingLine } from '@/lib/receiving/state-machine';
import { recordReceivingException } from '@/lib/receiving/exceptions';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import type { InventoryEventStation } from '@/lib/inventory/events';

const INBOUND_STATUSES: ReadonlySet<string> = new Set([
  'EXPECTED', 'ARRIVED', 'MATCHED', 'UNBOXED', 'AWAITING_TEST',
  'IN_TEST', 'PASSED', 'FAILED', 'RTV', 'SCRAP', 'DONE',
]);
const STATIONS: ReadonlySet<string> = new Set([
  'RECEIVING', 'TECH', 'PACK', 'SHIP', 'MOBILE', 'SYSTEM',
]);

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
      return NextResponse.json({ success: false, error: 'Valid line id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const to = String(body?.to || '').trim().toUpperCase();
    if (!INBOUND_STATUSES.has(to)) {
      return NextResponse.json(
        { success: false, error: `Valid target status required. Allowed: ${Array.from(INBOUND_STATUSES).join(', ')}` },
        { status: 400 },
      );
    }
    const expectedFromRaw = String(body?.expected_from || '').trim().toUpperCase();
    const expectedFrom = INBOUND_STATUSES.has(expectedFromRaw) ? expectedFromRaw : undefined;
    const notes = String(body?.notes || '').trim() || null;
    const clientEventId = String(body?.client_event_id || '').trim() || null;
    const exceptionCode = String(body?.exception_code || '').trim().toUpperCase() || undefined;
    const stationRaw = String(body?.station || '').trim().toUpperCase();
    const station: InventoryEventStation = (STATIONS.has(stationRaw) ? stationRaw : 'RECEIVING') as InventoryEventStation;
    const strict = body?.strict === true;

    const orgId = ctx.organizationId;

    const result = await transitionReceivingLine(
      {
        receivingLineId: lineId,
        to,
        expectedFrom,
        actorStaffId: ctx.staffId ?? null,
        station,
        clientEventId,
        notes,
        exceptionCode,
        eventType: 'NOTE',
        receivedBy: ctx.staffId ?? null,
        strict,
        payload: { source: 'manual_advance' },
      },
      undefined,
      orgId,
    );

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    // Flagging an exception (PROBLEM dimension) records a first-class line-level
    // receiving_exceptions row in addition to the line's exception_code column —
    // best-effort, never blocks the transition that already committed.
    if (exceptionCode) {
      try {
        await recordReceivingException(orgId, {
          receivingLineId: lineId,
          receivingId: result.receivingId,
          exceptionCode,
          reason: notes,
          createdBy: ctx.staffId ?? null,
        });
      } catch (err) {
        console.warn('receiving/lines/advance: receiving_exceptions write failed', err);
      }
    }

    await recordAudit(pool, ctx, request, {
      source: 'receiving.lines.advance',
      action: AUDIT_ACTION.RECEIVING_LINE_ADVANCE,
      entityType: AUDIT_ENTITY.RECEIVING_LINE,
      entityId: lineId,
      before: { workflow_status: result.from },
      after: { workflow_status: result.to, receiving_line_status: result.coarse },
      note: notes ?? undefined,
      extra: { coarse: result.coarse, exception_code: exceptionCode ?? null, changed: result.changed },
    });

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
        if (result.receivingId != null) {
          await publishReceivingLogChanged({
            organizationId: orgId,
            action: 'update',
            rowId: String(result.receivingId),
            source: 'receiving.lines.advance',
          });
        }
      } catch (err) {
        console.warn('receiving/lines/advance: cache/realtime failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      line_id: lineId,
      from: result.from,
      to: result.to,
      coarse: result.coarse,
      changed: result.changed,
      event_id: result.eventId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to advance line';
    console.error('receiving/lines/advance POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
