import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { packerLogs } from '@/lib/drizzle/schema';
import { normalizeTrackingCanonical, normalizeTrackingKey18 } from '@/lib/tracking-format';

type StartSessionRequest = {
  trackingNumber: string;
  packedBy: number;
  trackingType?: 'ORDERS' | 'SKU' | 'FBA' | 'FNSKU';
  scanRef?: string;
};

/**
 * POST /api/packing-logs/start-session
 *
 * Looks up the shipment_id from a tracking number, inserts a packer_logs row,
 * and returns the packerLogId so the mobile app can associate photos with it.
 */
export async function POST(req: NextRequest) {
  try {
    const body: StartSessionRequest = await req.json();
    const { trackingNumber, packedBy, trackingType = 'ORDERS', scanRef } = body;

    if (!trackingNumber || !packedBy) {
      return NextResponse.json(
        { success: false, error: 'trackingNumber and packedBy are required' },
        { status: 400 }
      );
    }

    const rawTracking = String(trackingNumber).trim();
    let shipmentId: number | null = null;
    let orderId: number | null = null;

    // For ORDERS type: resolve shipment_id from the tracking number
    if (trackingType === 'ORDERS') {
      const normalizedFull = normalizeTrackingCanonical(rawTracking);
      const trackingKey18 = normalizeTrackingKey18(rawTracking);

      if (normalizedFull && trackingKey18) {
        const client = await pool.connect();
        try {
          const result = await client.query(
            `SELECT o.id AS order_id, o.shipment_id
             FROM orders o
             JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
             WHERE RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
             ORDER BY o.id DESC
             LIMIT 1`,
            [trackingKey18]
          );
          if (result.rows.length > 0) {
            shipmentId = result.rows[0].shipment_id ?? null;
            orderId = result.rows[0].order_id ?? null;
          }
        } finally {
          client.release();
        }
      }
    }

    // Insert packer_logs row
    const [row] = await db
      .insert(packerLogs)
      .values({
        shipmentId: shipmentId ?? undefined,
        scanRef: scanRef ?? rawTracking,
        trackingType,
        packedBy,
      })
      .returning({ id: packerLogs.id });

    return NextResponse.json({
      success: true,
      packerLogId: row.id,
      shipmentId,
      orderId,
    });
  } catch (error: any) {
    console.error('[start-session] error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start packer session', details: error.message },
      { status: 500 }
    );
  }
}
