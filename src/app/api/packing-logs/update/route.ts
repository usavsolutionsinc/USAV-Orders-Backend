import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishPackerLogChanged, publishOrderChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { formatPSTTimestamp, normalizePSTTimestamp } from '@/utils/date';
import { createStationActivityLog } from '@/lib/station-activity';

const LEGACY_PACKER_ALIAS_TO_STAFF_ID: Record<string, number> = {
  '1': 4,
  '2': 5,
  '3': 6,
};

function resolvePackerStaffId(rawId: string | number | null | undefined): number | null {
  const normalized = String(rawId ?? '').trim();
  if (!normalized) return null;
  if (LEGACY_PACKER_ALIAS_TO_STAFF_ID[normalized]) {
    return LEGACY_PACKER_ALIAS_TO_STAFF_ID[normalized];
  }
  const numeric = Number(normalized);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Update packer_logs table (mobile app after photos are uploaded).
 * Shipped state is now derived from shipping_tracking_numbers, not stored on orders.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      shippingTrackingNumber,
      trackingType,
      packDateTime,
      packedBy,
      packerPhotosUrl,
      orderId
    } = body;

    console.log('=== PACKER_LOGS UPDATE REQUEST ===');
    console.log('Shipping Tracking Number:', shippingTrackingNumber);
    console.log('Tracking Type:', trackingType);
    console.log('Pack Date Time:', packDateTime);
    console.log('Packed By:', packedBy);
    console.log('Photos Count:', Array.isArray(packerPhotosUrl) ? packerPhotosUrl.length : 0);
    console.log('Order ID:', orderId);

    // Validation
    if (!shippingTrackingNumber) {
      return NextResponse.json({ error: 'shippingTrackingNumber is required' }, { status: 400 });
    }
    if (!trackingType) {
      return NextResponse.json({ error: 'trackingType is required' }, { status: 400 });
    }
    if (!packedBy) {
      return NextResponse.json({ error: 'packedBy is required' }, { status: 400 });
    }
    if (!Array.isArray(packerPhotosUrl) || packerPhotosUrl.length === 0) {
      return NextResponse.json({ error: 'packerPhotosUrl must be a non-empty array' }, { status: 400 });
    }

    const staffId = resolvePackerStaffId(packedBy);

    if (!staffId) {
      return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
    }

    const canonicalPackDate = normalizePSTTimestamp(packDateTime, { fallbackToNow: true })!;

    const photoUrlList: string[] = Array.isArray(packerPhotosUrl)
      ? packerPhotosUrl.filter((u: any) => typeof u === 'string' && u.trim())
      : [];

    console.log('=== DATABASE UPDATE ===');
    console.log('Staff ID:', staffId);
    console.log('Pack Date:', canonicalPackDate);
    console.log('Photos Count:', photoUrlList.length);

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Resolve shipment_id, then insert into packer_logs
      const { shipmentId: resolvedShipmentId, scanRef: resolvedScanRef } =
        await resolveShipmentId(shippingTrackingNumber);
      const insertResult = await client.query(`
        INSERT INTO packer_logs (
          shipment_id,
          scan_ref,
          tracking_type,
          created_at,
          packed_by
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [resolvedShipmentId, resolvedScanRef, trackingType, canonicalPackDate, staffId]);

      const packerLogId = insertResult.rows[0]?.id;
      console.log('Inserted into packer_logs, ID:', packerLogId);

      await createStationActivityLog(client, {
        station: 'PACK',
        activityType: 'PACK_COMPLETED',
        staffId,
        shipmentId: resolvedShipmentId ?? null,
        scanRef: resolvedScanRef ?? shippingTrackingNumber,
        packerLogId,
        notes: 'Mobile pack scan',
        metadata: {
          tracking_type: trackingType,
          photos_count: photoUrlList.length,
        },
        createdAt: canonicalPackDate,
      });

      // 2. Insert photo URLs into the unified photos table
      if (packerLogId && photoUrlList.length > 0) {
        for (const url of photoUrlList) {
          await client.query(
            `INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
             VALUES ('PACKER_LOG', $1, $2, $3, 'box_label')
             ON CONFLICT (entity_type, entity_id, url) DO NOTHING`,
            [packerLogId, url, staffId]
          );
        }
        console.log(`Inserted ${photoUrlList.length} photo(s) into photos table`);
      }

      // 3. Update orders table — mark status only; shipped state derived from stn carrier status
      const updateResult = await client.query(`
        UPDATE orders
        SET status = 'shipped'
        WHERE shipment_id = $1
          AND (status IS NULL OR status != 'shipped')
        RETURNING id, order_id, shipping_tracking_number
      `, [resolvedShipmentId]);

      console.log('=== UPDATE RESULT ===');
      if (updateResult.rows.length === 0) {
        // Fallback: match by last-8 text for legacy unlinked rows
        const fallbackUpdate = await client.query(`
          UPDATE orders
          SET status = 'shipped'
          WHERE RIGHT(shipping_tracking_number, 8) = RIGHT($1, 8)
            AND shipping_tracking_number IS NOT NULL
            AND shipping_tracking_number != ''
            AND (status IS NULL OR status != 'shipped')
          RETURNING id, order_id, shipping_tracking_number
        `, [shippingTrackingNumber]);
        if (fallbackUpdate.rows.length > 0) {
          const orderId = fallbackUpdate.rows[0].id;
          await client.query(`
            INSERT INTO work_assignments
                (entity_type, entity_id, work_type, assigned_packer_id,
                 completed_by_packer_id, status, priority, notes, completed_at)
            VALUES ('ORDER', $1, 'PACK', $2, $2, 'DONE', 100, 'Auto-completed on mobile pack scan', NOW())
            ON CONFLICT (entity_type, entity_id, work_type)
                WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
            DO UPDATE
                SET assigned_packer_id     = EXCLUDED.assigned_packer_id,
                    completed_by_packer_id = EXCLUDED.completed_by_packer_id,
                    status                 = 'DONE',
                    completed_at           = NOW(),
                    updated_at             = NOW()
          `, [orderId, staffId]);
        }
      } else {
        console.log('✅ Updated orders table status = shipped');
        const orderId = updateResult.rows[0].id;
        await client.query(`
          INSERT INTO work_assignments
              (entity_type, entity_id, work_type, assigned_packer_id,
               completed_by_packer_id, status, priority, notes, completed_at)
          VALUES ('ORDER', $1, 'PACK', $2, $2, 'DONE', 100, 'Auto-completed on mobile pack scan', NOW())
          ON CONFLICT (entity_type, entity_id, work_type)
              WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
          DO UPDATE
              SET assigned_packer_id     = EXCLUDED.assigned_packer_id,
                  completed_by_packer_id = EXCLUDED.completed_by_packer_id,
                  status                 = 'DONE',
                  completed_at           = NOW(),
                  updated_at             = NOW()
        `, [orderId, staffId]);
      }

      await client.query('COMMIT');

      await invalidateCacheTags(['packing-logs', 'packerlogs', 'orders', 'shipped']);

      // Build packer-log row for live surgical insert on all subscribed web sessions.
      const shippedOrderId = updateResult.rows[0]?.id ?? null;  // may be null for unlinked rows
      const packerRow = {
        id: packerLogId,
        created_at: canonicalPackDate,
        shipping_tracking_number: shippingTrackingNumber,
        packed_by: staffId,
        order_id: updateResult.rows[0]?.order_id ?? null,
        product_title: null,
        quantity: null,
        condition: null,
        sku: null,
        photos: photoUrlList,
      };
      await publishPackerLogChanged({
        packerId: staffId,
        action: 'insert',
        packerLogId,
        row: packerRow,
        source: 'packing-logs.update',
      });
      if (shippedOrderId) {
        await publishOrderChanged({ orderIds: [shippedOrderId], source: 'packing-logs.update' });
      }

      return NextResponse.json({
        success: true,
        message: 'Packer logs updated and order marked as shipped',
        packerLogId,
        ordersUpdated: updateResult.rows.length,
        trackingNumber: shippingTrackingNumber,
        trackingType,
        photosCount: photoUrlList.length
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Error updating packer_logs:', error);
    return NextResponse.json({
      error: 'Failed to update packer_logs',
      details: error.message
    }, { status: 500 });
  }
}
