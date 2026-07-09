/**
 * PATCH /api/receiving/lines/[id]/zoho-note
 *
 * Save the per-line Zoho **item description** (`receiving_lines.zoho_notes`) and
 * push the same text to the linked Zoho PO line item's `description` field.
 * Edited inline in the PO-items row (the notes-icon toggle).
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import {
  syncItemDescriptionToZohoPo,
  type SyncItemDescriptionResult,
} from '@/lib/receiving/zoho-item-description-sync';

type LineRow = {
  id: number;
  zoho_purchaseorder_id: string | null;
  zoho_line_item_id: string | null;
  sku: string | null;
  item_name: string | null;
};

function savedLabelForZoho(
  description: string | null,
  zoho: SyncItemDescriptionResult,
): string {
  if (!description) return 'Item description cleared';
  if (zoho.patched) return 'Item description updated in Zoho';
  if (zoho.skipped === 'no_zoho_link') return 'Item description saved locally';
  if (zoho.skipped === 'no_line_item_id') {
    return 'Item description saved locally — sync with Zoho first';
  }
  if (zoho.skipped === 'po_not_editable') {
    return 'Item description saved locally — Zoho PO is not editable';
  }
  return 'Item description updated';
}

export async function PATCH(
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
    if (!Object.prototype.hasOwnProperty.call(body, 'zoho_notes')) {
      return NextResponse.json({ success: false, error: 'zoho_notes is required' }, { status: 400 });
    }
    const raw = body.zoho_notes;
    const next = raw == null || raw === '' ? null : String(raw).trim() || null;
    const orgId = ctx.organizationId;

    const lineRes = await tenantQuery<LineRow>(
      orgId,
      `SELECT id, zoho_purchaseorder_id, zoho_line_item_id, sku, item_name
         FROM receiving_lines
        WHERE id = $1 AND organization_id = $2
        LIMIT 1`,
      [lineId, orgId],
    );
    const line = lineRes.rows[0];
    if (!line) {
      return NextResponse.json({ success: false, error: `receiving_line ${lineId} not found` }, { status: 404 });
    }

    const updateRes = await tenantQuery<{ id: number }>(
      orgId,
      `UPDATE receiving_lines SET zoho_notes = $1, updated_at = NOW()
         WHERE id = $2 AND organization_id = $3 RETURNING id`,
      [next, lineId, orgId],
    );
    if (updateRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: `receiving_line ${lineId} not found` }, { status: 404 });
    }

    const zoho = await syncItemDescriptionToZohoPo({
      zohoPoId: line.zoho_purchaseorder_id,
      zohoLineItemId: line.zoho_line_item_id,
      sku: line.sku,
      itemName: line.item_name,
      description: next,
    });

    if (zoho.resolved_line_item_id && zoho.resolved_line_item_id !== line.zoho_line_item_id) {
      await tenantQuery(
        orgId,
        `UPDATE receiving_lines SET zoho_line_item_id = $1, updated_at = NOW()
           WHERE id = $2 AND organization_id = $3`,
        [zoho.resolved_line_item_id, lineId, orgId],
      );
    }

    after(async () => {
      try { await invalidateCacheTags(['receiving-lines', 'receiving-logs']); } catch { /* best-effort */ }
    });

    if (!zoho.ok && !zoho.skipped) {
      return NextResponse.json(
        {
          success: false,
          error: zoho.error || 'Zoho item description update failed',
          line_id: lineId,
          zoho_notes: next,
          zoho,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      line_id: lineId,
      zoho_notes: next,
      zoho,
      saved_label: savedLabelForZoho(next, zoho),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save item description';
    console.error('receiving/lines/[id]/zoho-note PATCH failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
