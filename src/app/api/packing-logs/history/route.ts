import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * GET /api/packing-logs/history?limit=10
 *
 * Returns the signed-in staff's most recent packed orders for the phone
 * history popover. Auth comes from the `usav_sid` cookie — there is no
 * `staffId` query param.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ entries: [] });
    }

    const { searchParams } = new URL(req.url);
    const rawLimit = Number(searchParams.get('limit') ?? '10');
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
      : 10;

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
       LIMIT $2`,
      [user.staffId, limit],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ entries: [] });
    }

    const logIds = result.rows.map((r: any) => r.packer_log_id);
    const photosResult = await pool.query(
      `SELECT id, entity_id, url, photo_type, created_at
       FROM photos
       WHERE entity_type = 'PACKER_LOG' AND entity_id = ANY($1::int[])
       ORDER BY created_at ASC`,
      [logIds],
    );

    const photosByLog = new Map<number, any[]>();
    for (const p of photosResult.rows) {
      const arr = photosByLog.get(p.entity_id) ?? [];
      arr.push({
        id: p.id,
        url: p.url,
        photoType: p.photo_type,
        createdAt: p.created_at,
      });
      photosByLog.set(p.entity_id, arr);
    }

    const entries = result.rows.map((row: any) => ({
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
      photos: photosByLog.get(row.packer_log_id) ?? [],
      resumeHref: '/packer',
    }));

    return NextResponse.json({ entries });
  } catch (error: any) {
    console.error('[packing-logs/history] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch packing history', details: error.message },
      { status: 500 },
    );
  }
}
