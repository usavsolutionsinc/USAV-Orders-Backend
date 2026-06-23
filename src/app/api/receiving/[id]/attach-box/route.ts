import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { attachBoxToReceiving } from '@/lib/receiving/attach-box';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/receiving/:id/attach-box
 *
 * Attach an ADDITIONAL carrier tracking number (a 2nd/3rd/… carton) to an
 * already-anchored receiving carton — the multi-tracking → PO path
 * (docs/multi-tracking-po-plan.md, Phase 1).
 *
 * The reference# tracking stays the primary anchor (`receiving.shipment_id`).
 * Because the box attaches to the carton (which carries the PO), it inherently
 * links to that Zoho PO — no separate PO write needed. Junction logic lives in
 * the shared `attachBoxToReceiving` core (also used by the PO-level route).
 *
 * Body: { trackingNumber: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.mark_received');
    if (gate.denied) return gate.denied;
    const ctx = gate.ctx;
    const staffId = Number(ctx.staffId) || null;

    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid id is required' },
        { status: 400 },
      );
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json(
        { success: false, error: 'Content-Type must be application/json' },
        { status: 415 },
      );
    }
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json(
          { success: false, error: 'Body must be a JSON object' },
          { status: 400 },
        );
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const tracking = String(body.trackingNumber ?? '').trim();
    if (!tracking) {
      return NextResponse.json(
        { success: false, error: 'trackingNumber is required' },
        { status: 400 },
      );
    }

    const result = await attachBoxToReceiving({
      receivingId: id,
      trackingNumber: tracking,
      staffId,
      organizationId: ctx.organizationId,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({
      organizationId: ctx.organizationId,
      action: 'update',
      rowId: String(id),
      source: 'receiving.attach-box',
    });

    await recordAudit(pool, ctx, request, {
      source: 'receiving.attach-box',
      action: AUDIT_ACTION.RECEIVING_HEADER_UPDATE,
      entityType: AUDIT_ENTITY.RECEIVING,
      entityId: id,
      before: null,
      after: {
        shipment_id: result.shipmentId,
        tracking_number: tracking,
        box_seq: result.boxSeq,
        is_primary: result.isPrimary,
        already_attached: result.alreadyAttached,
      },
      method: 'manual',
    });

    return NextResponse.json({
      success: true,
      receiving_id: id,
      shipment_id: result.shipmentId,
      already_attached: result.alreadyAttached,
      box_count: result.boxCount,
      boxes: result.boxes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to attach box';
    console.error('receiving/[id]/attach-box POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
