import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

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
    console.log('Photos Count:', packerPhotosUrl?.length);
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

    // Map mobile packerId (1, 2) to staff IDs (4, 5)
    const packerStaffIds: { [key: number]: number } = {
      1: 4,  // Tuan
      2: 5,  // Thuy
      3: 6   // Future packer
    };
    const staffId = packerStaffIds[packedBy];

    if (!staffId) {
      return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
    }

    // Parse pack date time
    const packDate = packDateTime ? new Date(packDateTime) : new Date();
    
    // Format photos as JSONB
    const photosJsonb = JSON.stringify(packerPhotosUrl.map((url, index) => ({
      url,
      index: index + 1,
      uploadedAt: new Date().toISOString()
    })));

    console.log('=== DATABASE UPDATE ===');
    console.log('Staff ID:', staffId);
    console.log('Pack Date:', packDate);
    console.log('Photos JSONB:', photosJsonb);

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
          packed_by,
          packer_photos_url
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING id
      `, [shippingTrackingNumber, trackingType, packDate, staffId, photosJsonb]);

      const packerLogId = insertResult.rows[0]?.id;
      console.log('Inserted into packer_logs, ID:', packerLogId);

      // 2. Update orders table - set is_shipped to true only if not already shipped
      // Match using last 8 digits to handle scanned vs manual entry variations
      const updateResult = await client.query(`
        UPDATE orders
        SET 
          is_shipped = true,
          status = 'shipped',
          packer_id = $1
        WHERE RIGHT(shipping_tracking_number, 8) = RIGHT($2, 8)
        AND shipping_tracking_number IS NOT NULL
        AND shipping_tracking_number != ''
        AND is_shipped = false
        RETURNING id, order_id, shipping_tracking_number
      `, [staffId, shippingTrackingNumber]);

      if (updateResult.rows.length === 0) {
        console.warn('No order found with matching last 8 digits:', shippingTrackingNumber.slice(-8));
        console.warn('Full tracking number sent:', shippingTrackingNumber);
        // Don't fail if order not found - packer_logs still saved
      } else {
        console.log('Updated orders table successfully');
        console.log('Order ID:', updateResult.rows[0].order_id);
        console.log('DB Tracking:', updateResult.rows[0].shipping_tracking_number);
        console.log('Matched last 8 digits:', shippingTrackingNumber.slice(-8));
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        message: 'Packer logs updated and order marked as shipped',
        packerLogId,
        ordersUpdated: updateResult.rows.length,
        trackingNumber: shippingTrackingNumber,
        trackingType,
        photosCount: packerPhotosUrl.length
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
