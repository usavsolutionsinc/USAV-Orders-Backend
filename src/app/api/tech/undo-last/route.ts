import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tracking = String(body?.tracking || '').trim();
    const techIdRaw = body?.techId;
    const techId = Number.isFinite(Number(techIdRaw)) ? Number(techIdRaw) : null;

    if (!tracking) {
      return NextResponse.json({ success: false, error: 'Tracking is required' }, { status: 400 });
    }
    const key18 = normalizeTrackingKey18(tracking);
    if (!key18 || key18.length < 8) {
      return NextResponse.json({ success: false, error: 'Invalid tracking number' }, { status: 400 });
    }

    const { shipmentId: resolvedShipmentId, scanRef: resolvedScanRef } = await resolveShipmentId(tracking);

    let techFilter = '';
    const latestParams: any[] = [resolvedShipmentId, resolvedScanRef ?? tracking];
    if (techId) {
      latestParams.push(techId);
      techFilter = ` AND tsn.tested_by = $${latestParams.length} `;
    }

    const latestResult = await pool.query(
      `SELECT tsn.id, tsn.serial_number
       FROM tech_serial_numbers tsn
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
       WHERE (
           (tsn.shipment_id IS NOT NULL AND tsn.shipment_id = $1)
           OR (tsn.shipment_id IS NULL AND tsn.scan_ref = $2)
           OR (stn.tracking_number_normalized IS NOT NULL
               AND RIGHT(stn.tracking_number_normalized, 18) = RIGHT(regexp_replace(UPPER($2::text), '[^A-Z0-9]', '', 'g'), 18))
         )
         AND tsn.serial_number IS NOT NULL
         AND tsn.serial_number != ''
         ${techFilter}
       ORDER BY tsn.created_at DESC NULLS LAST, tsn.id DESC
       LIMIT 1`,
      latestParams
    );

    if (latestResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'No scanned serial found to undo' }, { status: 404 });
    }

    const row = latestResult.rows[0];
    await pool.query('DELETE FROM tech_serial_numbers WHERE id = $1', [row.id]);
    await invalidateCacheTags(['tech-logs', 'orders-next']);
    if (techId) {
      await publishTechLogChanged({
        techId,
        action: 'delete',
        rowId: row.id,
        source: 'tech.undo-last',
      });
    }

    const remainingResult = await pool.query(
      `SELECT tsn.serial_number
       FROM tech_serial_numbers tsn
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
       WHERE (
           (tsn.shipment_id IS NOT NULL AND tsn.shipment_id = $1)
           OR (tsn.shipment_id IS NULL AND tsn.scan_ref = $2)
           OR (stn.tracking_number_normalized IS NOT NULL
               AND RIGHT(stn.tracking_number_normalized, 18) = RIGHT(regexp_replace(UPPER($2::text), '[^A-Z0-9]', '', 'g'), 18))
         )
         AND tsn.serial_number IS NOT NULL
         AND tsn.serial_number != ''
       ORDER BY tsn.created_at ASC NULLS LAST, tsn.id ASC`,
      [resolvedShipmentId, resolvedScanRef ?? tracking]
    );

    return NextResponse.json({
      success: true,
      removedSerial: row.serial_number,
      serialNumbers: remainingResult.rows.map((r: any) => r.serial_number),
    });
  } catch (error: any) {
    console.error('Undo last scan error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to undo latest scan' },
      { status: 500 }
    );
  }
}
