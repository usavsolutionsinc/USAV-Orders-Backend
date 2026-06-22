/**
 * POST /api/receiving-lines/incoming/sync-one
 *
 * Per-order "Sync" button in the Incoming details panel. Refreshes ONE PO
 * end-to-end without running the whole Incoming sweep:
 *
 *   1. PO mirror — re-pull the PO header/status from Zoho (syncOnePoMirror).
 *      If Zoho now reports it received/closed, the mirror status updates and
 *      the Incoming filter drops it on the next read.
 *   2. Shipment — if the PO's receiving row has a linked shipment, re-poll
 *      the carrier (syncShipment) so the tracking status is current.
 *
 * Body: { po_id: string }  (zoho_purchaseorder_id)
 * Gated `receiving.view` to match the Incoming toolbar siblings.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { errorResponse } from '@/lib/api';
import { syncOnePoMirror } from '@/lib/zoho/po-mirror-sync';
import { syncShipment } from '@/lib/shipping/sync-shipment';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as { po_id?: string };
    const poId = String(body?.po_id || '').trim();
    if (!poId) {
      return NextResponse.json({ success: false, error: 'po_id is required' }, { status: 400 });
    }

    // 1. PO mirror refresh (header + status).
    const mirror = await syncOnePoMirror(poId, ctx.organizationId);

    // 2. Shipment re-poll, if this PO's receiving row has one linked.
    //    receiving is tenant-owned — scope to this org so a PO id from another
    //    tenant can't resolve a foreign shipment to re-poll.
    const recvRes = await tenantQuery<{ shipment_id: number | null }>(
      ctx.organizationId,
      `SELECT r.shipment_id
         FROM receiving r
        WHERE r.source = 'zoho_po'
          AND r.zoho_purchaseorder_id = $1
          AND r.organization_id = $2
        LIMIT 1`,
      [poId, ctx.organizationId],
    );
    const shipmentId = recvRes.rows[0]?.shipment_id ?? null;

    let shipment: { polled: boolean; status?: string | null; error?: string | null } = { polled: false };
    if (shipmentId != null) {
      try {
        const r = await syncShipment({ shipmentId });
        shipment = r.ok
          ? { polled: true, status: r.status ?? null }
          : { polled: false, error: r.error ?? r.errorCode ?? 'sync failed' };
      } catch (err) {
        shipment = { polled: false, error: err instanceof Error ? err.message : 'sync failed' };
      }
    }

    // Re-read the rail + tiles + open panel on the next refetch.
    try {
      await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
    } catch (err) {
      console.warn('incoming/sync-one: cache invalidate failed (non-fatal)', err);
    }

    return NextResponse.json({
      success: true,
      po_id: poId,
      mirror: { found: mirror.found, status: mirror.status },
      shipment,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving-lines/incoming/sync-one');
  }
}, { permission: 'receiving.view' });
