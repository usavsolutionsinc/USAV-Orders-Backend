/**
 * POST /api/receiving/[id]/zoho-sync
 *
 * Pull-from-Zoho for a single carton. Resolves the carton's Zoho PO id (header
 * OR line-level — see resolveCartonZohoPoId) and re-imports that PO into the
 * local receiving / receiving_lines via importZohoPurchaseOrderToReceiving,
 * which refreshes:
 *   • receiving.zoho_notes        ← PO header `notes`   (the Zoho Notes tab)
 *   • receiving_lines.unit_price  ← line `rate`         (the price display)
 *   • receiving_lines.zoho_notes  ← line `description`  (item descriptions)
 *
 * This is the read direction that complements the per-field push (Save to Zoho
 * notes, item-description PUT). The workspace header Refresh button and the
 * Zoho Notes tab both call this so the local cache matches Zoho on demand.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { resolveCartonZohoPoId } from '@/lib/receiving/resolve-carton-po-id';
import { importZohoPurchaseOrderToReceiving } from '@/lib/zoho-receiving-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.scan_po');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;

    const { id: idRaw } = await params;
    const receivingId = Number(idRaw);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid receiving id is required' }, { status: 400 });
    }

    const poId = await resolveCartonZohoPoId(orgId, receivingId);
    if (!poId) {
      return NextResponse.json({ success: true, skipped: 'no_zoho_link', zoho_notes: null });
    }

    try {
      await importZohoPurchaseOrderToReceiving(orgId, poId, { receivingId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Zoho sync failed';
      console.warn('receiving/[id]/zoho-sync import failed', receivingId, poId, message);
      return NextResponse.json({ success: false, error: message }, { status: 502 });
    }

    after(async () => {
      try { await invalidateCacheTags(['receiving-lines', 'receiving-logs']); } catch { /* best-effort */ }
    });

    // Read back the synced carton notes so the caller can refresh its display.
    const res = await tenantQuery<{ zoho_notes: string | null }>(
      orgId,
      `SELECT zoho_notes FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [receivingId, orgId],
    );

    return NextResponse.json({
      success: true,
      purchaseorder_id: poId,
      zoho_notes: res.rows[0]?.zoho_notes ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync from Zoho';
    console.error('receiving/[id]/zoho-sync POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
