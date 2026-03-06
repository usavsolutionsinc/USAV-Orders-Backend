import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishPackerLogChanged, publishOrderChanged } from '@/lib/realtime/publish';

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
 * Update packer_logs table and set orders.is_shipped to true
 * Called from mobile app after photos are uploaded
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

    const packDate = packDateTime ? new Date(packDateTime) : new Date();

    const photoUrlList: string[] = Array.isArray(packerPhotosUrl)
      ? packerPhotosUrl.filter((u: any) => typeof u === 'string' && u.trim())
      : [];

    console.log('=== DATABASE UPDATE ===');
    console.log('Staff ID:', staffId);
    console.log('Pack Date:', packDate);
    console.log('Photos Count:', photoUrlList.length);

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert into packer_logs table
      const insertResult = await client.query(`
        INSERT INTO packer_logs (
          shipping_tracking_number,
          tracking_type,
          pack_date_time,
          packed_by
        ) VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [shippingTrackingNumber, trackingType, packDate, staffId]);

      const packerLogId = insertResult.rows[0]?.id;
      console.log('Inserted into packer_logs, ID:', packerLogId);

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

      // 3. First check if order exists and its current state
      const checkResult = await client.query(`
        SELECT id, order_id, shipping_tracking_number, is_shipped, status
        FROM orders
        WHERE RIGHT(shipping_tracking_number, 8) = RIGHT($1, 8)
        AND shipping_tracking_number IS NOT NULL
        AND shipping_tracking_number != ''
        LIMIT 1
      `, [shippingTrackingNumber]);

      console.log('=== ORDERS TABLE CHECK ===');
      if (checkResult.rows.length === 0) {
        console.error('❌ NO ORDER FOUND with last 8 digits:', shippingTrackingNumber.slice(-8));
        console.error('   Full tracking sent:', shippingTrackingNumber);
      } else {
        const orderState = checkResult.rows[0];
        console.log('✅ Order found in database:');
        console.log('   Order ID:', orderState.order_id);
        console.log('   DB Tracking:', orderState.shipping_tracking_number);
        console.log('   Current is_shipped:', orderState.is_shipped);
        console.log('   Current status:', orderState.status);
        console.log('   Sent tracking last 8:', shippingTrackingNumber.slice(-8));
        console.log('   DB tracking last 8:', orderState.shipping_tracking_number.slice(-8));
      }

      // 3. Update orders table - set is_shipped to true only if not already shipped.
      // packer_id is no longer a column on orders; assignment recorded in work_assignments below.
      const updateResult = await client.query(`
        UPDATE orders
        SET
          is_shipped = true,
          status = 'shipped'
        WHERE RIGHT(shipping_tracking_number, 8) = RIGHT($1, 8)
        AND shipping_tracking_number IS NOT NULL
        AND shipping_tracking_number != ''
        AND is_shipped = false
        RETURNING id, order_id, shipping_tracking_number
      `, [shippingTrackingNumber]);

      console.log('=== UPDATE RESULT ===');
      if (updateResult.rows.length === 0) {
        console.warn('⚠️  NO ROWS UPDATED');
        if (checkResult.rows.length > 0 && checkResult.rows[0].is_shipped === true) {
          console.warn('   Reason: Order was already marked as shipped');
        } else {
          console.warn('   Reason: No matching order found or other constraint failed');
        }
      } else {
        console.log('✅ Updated orders table successfully');
        console.log('   Order ID:', updateResult.rows[0].order_id);
        console.log('   DB Tracking:', updateResult.rows[0].shipping_tracking_number);
        console.log('   Set is_shipped = true');
        console.log('   Set status = shipped');
        console.log('   Set packer_id (work_assignments) =', staffId);

        // Record packer assignment in work_assignments
        const orderId = updateResult.rows[0].id;
        await client.query(`
          INSERT INTO work_assignments
              (entity_type, entity_id, work_type, assigned_packer_id, status, priority, notes, completed_at)
          VALUES ('ORDER', $1, 'PACK', $2, 'DONE', 100, 'Auto-completed on mobile pack scan', NOW())
          ON CONFLICT (entity_type, entity_id, work_type)
              WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
          DO UPDATE
              SET assigned_packer_id = EXCLUDED.assigned_packer_id,
                  status             = 'DONE',
                  completed_at       = NOW(),
                  updated_at         = NOW()
        `, [orderId, staffId]);
      }

      await client.query('COMMIT');

      await invalidateCacheTags(['packing-logs', 'packerlogs', 'orders', 'shipped']);

      // Build packer-log row for live surgical insert on all subscribed web sessions.
      const shippedOrderId = updateResult.rows[0]?.id ?? null;
      const packerRow = {
        id: packerLogId,
        pack_date_time: packDate.toISOString(),
        shipping_tracking_number: shippingTrackingNumber,
        packed_by: staffId,
        order_id: updateResult.rows[0]?.order_id ?? null,
        product_title: null,
        quantity: null,
        condition: null,
        sku: null,
        packer_photos_url: photoUrlList,
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
