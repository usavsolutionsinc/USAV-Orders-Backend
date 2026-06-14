import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import {
  attachBoxToReceiving,
  ensureReceivingForPo,
  listBoxesForReceiving,
} from '@/lib/receiving/attach-box';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/receiving/po/:poId/attach-box
 *
 * Attach a carrier tracking number to a PURCHASE ORDER — used by the Incoming-tab
 * popover to pre-register a vendor's tracking numbers BEFORE the boxes arrive
 * (docs/multi-tracking-po-plan.md, Phase 4b).
 *
 * Get-or-creates the PO's `receiving` carton locally (no Zoho round-trip) without
 * linking its lines — so the PO stays in the Incoming view — then attaches the
 * tracking via the shared `attachBoxToReceiving` core. Because `view=incoming`
 * joins the carton by PO id preferring a row with a shipment_id, the first
 * attached tracking flips the PO's delivery_state from AWAITING_TRACKING → carrier
 * status automatically.
 *
 * `poId` may be a Zoho purchaseorder_id or a PO number/reference.
 * Body: { trackingNumber: string }
 */

/** Resolve a Zoho purchaseorder_id (or PO number/reference) to the canonical id. */
async function resolvePo(
  poIdInput: string,
): Promise<{ poId: string; poNumber: string | null } | null> {
  const norm = poIdInput.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const resolved = await pool.query<{ zoho_purchaseorder_id: string; zoho_purchaseorder_number: string | null }>(
    `SELECT zoho_purchaseorder_id, zoho_purchaseorder_number
       FROM receiving_lines
      WHERE zoho_purchaseorder_id = $1
         OR zoho_purchaseorder_number_norm = $2
      ORDER BY id DESC
      LIMIT 1`,
    [poIdInput, norm],
  );
  let poId = resolved.rows[0]?.zoho_purchaseorder_id ?? null;
  let poNumber = resolved.rows[0]?.zoho_purchaseorder_number ?? null;
  if (!poId) {
    const m = await pool.query<{ zoho_purchaseorder_id: string; zoho_purchaseorder_number: string | null }>(
      `SELECT zoho_purchaseorder_id, zoho_purchaseorder_number
         FROM zoho_po_mirror
        WHERE zoho_purchaseorder_id = $1
           OR zoho_purchaseorder_number_norm = $2
        ORDER BY last_synced_at DESC NULLS LAST
        LIMIT 1`,
      [poIdInput, norm],
    );
    poId = m.rows[0]?.zoho_purchaseorder_id ?? null;
    poNumber = poNumber ?? m.rows[0]?.zoho_purchaseorder_number ?? null;
  }
  return poId ? { poId, poNumber } : null;
}

/**
 * GET /api/receiving/po/:poId/attach-box
 *
 * List the boxes (tracking numbers) already attached to a PO's carton — lets the
 * attach popover preload existing boxes so repeat opens show what's linked instead
 * of an empty list. Read-only: does NOT get-or-create the carton.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ poId: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.mark_received');
    if (gate.denied) return gate.denied;

    const { poId: poIdRaw } = await params;
    const poIdInput = decodeURIComponent(String(poIdRaw ?? '')).trim();
    if (!poIdInput) {
      return NextResponse.json(
        { success: false, error: 'PO id is required' },
        { status: 400 },
      );
    }

    const po = await resolvePo(poIdInput);
    if (!po) {
      return NextResponse.json(
        { success: false, error: 'No matching purchase order found' },
        { status: 404 },
      );
    }

    const carton = await pool.query<{ id: number }>(
      `SELECT id FROM receiving
        WHERE source = 'zoho_po' AND zoho_purchaseorder_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [po.poId],
    );
    const receivingId = carton.rows[0]?.id ?? null;
    const boxes = receivingId ? await listBoxesForReceiving(receivingId) : [];

    return NextResponse.json({
      success: true,
      po_id: po.poId,
      po_number: po.poNumber,
      receiving_id: receivingId,
      box_count: boxes.length,
      boxes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list PO boxes';
    console.error('receiving/po/[poId]/attach-box GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ poId: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.mark_received');
    if (gate.denied) return gate.denied;
    const ctx = gate.ctx;
    const staffId = Number(ctx.staffId) || null;

    const { poId: poIdRaw } = await params;
    const poIdInput = decodeURIComponent(String(poIdRaw ?? '')).trim();
    if (!poIdInput) {
      return NextResponse.json(
        { success: false, error: 'PO id is required' },
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

    // Resolve the PO (accept a Zoho purchaseorder_id or a PO number/reference).
    const po = await resolvePo(poIdInput);
    if (!po) {
      return NextResponse.json(
        { success: false, error: 'No matching purchase order found' },
        { status: 404 },
      );
    }
    const { poId, poNumber } = po;

    const receivingId = await ensureReceivingForPo({ poId, poNumber });

    const result = await attachBoxToReceiving({ receivingId, trackingNumber: tracking, staffId });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({
      organizationId: ctx.organizationId,
      action: 'update',
      rowId: String(receivingId),
      source: 'receiving.po.attach-box',
    });

    await recordAudit(pool, ctx, request, {
      source: 'receiving.po.attach-box',
      action: AUDIT_ACTION.RECEIVING_HEADER_UPDATE,
      entityType: AUDIT_ENTITY.RECEIVING,
      entityId: receivingId,
      before: null,
      after: {
        zoho_purchaseorder_id: poId,
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
      po_id: poId,
      po_number: poNumber,
      receiving_id: receivingId,
      shipment_id: result.shipmentId,
      already_attached: result.alreadyAttached,
      box_count: result.boxCount,
      boxes: result.boxes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to attach box to PO';
    console.error('receiving/po/[poId]/attach-box POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
