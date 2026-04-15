import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';

const SOURCE_PLATFORMS = new Set([
  'zoho',
  'ebay',
  'amazon',
  'aliexpress',
  'walmart',
  'other',
  'goodwill',
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (Object.prototype.hasOwnProperty.call(body, 'source_platform')) {
      const raw = body.source_platform;
      const next = raw == null || raw === '' ? null : String(raw).trim().toLowerCase();
      if (next != null && !SOURCE_PLATFORMS.has(next)) {
        return NextResponse.json(
          { success: false, error: `Invalid source_platform. Allowed: ${Array.from(SOURCE_PLATFORMS).join(', ')}` },
          { status: 400 },
        );
      }
      updates.push(`source_platform = $${idx++}`);
      values.push(next);
    }

    // PO# linkage — writing either flips `source` to 'zoho_po' so the soft-join
    // in /api/receiving-lines GET can find this carton by PO#.
    let poWrittenNonNull = false;
    if (Object.prototype.hasOwnProperty.call(body, 'zoho_purchaseorder_id')) {
      const raw = body.zoho_purchaseorder_id;
      const next = raw == null || raw === '' ? null : String(raw).trim();
      updates.push(`zoho_purchaseorder_id = $${idx++}`);
      values.push(next);
      if (next) poWrittenNonNull = true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'zoho_purchaseorder_number')) {
      const raw = body.zoho_purchaseorder_number;
      const next = raw == null || raw === '' ? null : String(raw).trim();
      updates.push(`zoho_purchaseorder_number = $${idx++}`);
      values.push(next);
    }
    if (poWrittenNonNull) {
      // Only upgrade 'unmatched' → 'zoho_po'. Never downgrade.
      updates.push(`source = CASE WHEN source = 'zoho_po' THEN source ELSE 'zoho_po' END`);
    }

    // Optional tracking link — register the tracking number via the shipping
    // backbone (idempotent) and stamp the returned shipment_id on this row.
    let registeredShipmentId: number | null = null;
    if (Object.prototype.hasOwnProperty.call(body, 'reference_number')
     || Object.prototype.hasOwnProperty.call(body, 'tracking_number')) {
      const rawTracking = body.reference_number ?? body.tracking_number;
      const trackingStr = rawTracking == null ? '' : String(rawTracking).trim();
      if (trackingStr) {
        const shipment = await registerShipmentPermissive({
          trackingNumber: trackingStr,
          sourceSystem: 'receiving.link-po',
        });
        if (shipment?.id) {
          registeredShipmentId = Number(shipment.id);
          updates.push(`shipment_id = $${idx++}`);
          values.push(registeredShipmentId);
          // Keep legacy receiving_tracking_number in sync for older readers.
          updates.push(`receiving_tracking_number = COALESCE(receiving_tracking_number, $${idx++})`);
          values.push(trackingStr);
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query<{
      id: number;
      source_platform: string | null;
      zoho_purchaseorder_id: string | null;
      zoho_purchaseorder_number: string | null;
      shipment_id: number | null;
    }>(
      `UPDATE receiving SET ${updates.join(', ')} WHERE id = $${values.length}
       RETURNING id, source_platform, zoho_purchaseorder_id, zoho_purchaseorder_number, shipment_id`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving not found' }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({
      action: 'update',
      rowId: String(id),
      source: 'receiving.patch',
    });

    return NextResponse.json({ success: true, receiving: result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update receiving';
    console.error('receiving/[id] PATCH failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
