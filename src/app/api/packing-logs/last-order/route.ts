import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/packing-logs/last-order?staffId=X
 *
 * Returns the most recently packed order for a given staff member,
 * including order details and associated photos.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const staffId = searchParams.get('staffId');

    if (!staffId) {
      return NextResponse.json({ error: 'staffId is required' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         pl.id              AS packer_log_id,
         pl.tracking_type,
         pl.created_at,
         pl.scan_ref,
         COALESCE(stn.tracking_number_raw, pl.scan_ref) AS tracking,
         stn.carrier,
         o.order_id,
         o.product_title,
         o.condition,
         o.quantity,
         o.sku,
         o.item_number
       FROM packer_logs pl
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
       LEFT JOIN orders o ON o.shipment_id = pl.shipment_id AND pl.shipment_id IS NOT NULL
       WHERE pl.packed_by = $1
       ORDER BY pl.id DESC
       LIMIT 1`,
      [Number(staffId)],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ lastOrder: null });
    }

    const row = result.rows[0];

    // Fetch associated photos
    const photosResult = await pool.query(
      `SELECT id, url, photo_type, created_at
       FROM photos
       WHERE entity_type = 'PACKER_LOG' AND entity_id = $1
       ORDER BY created_at ASC`,
      [row.packer_log_id],
    );

    return NextResponse.json({
      lastOrder: {
        packerLogId: row.packer_log_id,
        trackingType: row.tracking_type,
        packedAt: row.created_at,
        tracking: row.tracking,
        carrier: row.carrier,
        orderId: row.order_id,
        productTitle: row.product_title,
        condition: row.condition,
        quantity: row.quantity ?? 1,
        sku: row.sku,
        itemNumber: row.item_number,
        photos: photosResult.rows.map((p: any) => ({
          id: p.id,
          url: p.url,
          photoType: p.photo_type,
          createdAt: p.created_at,
        })),
      },
    });
  } catch (error: any) {
    console.error('[packing-logs/last-order] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch last order', details: error.message },
      { status: 500 },
    );
  }
}
