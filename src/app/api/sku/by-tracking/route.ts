import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { resolveShipmentId } from '@/lib/shipping/resolve';

/**
 * GET /api/sku/by-tracking?tracking=xxx
 *
 * Returns the sku record whose shipping_tracking_number matches, along with
 * all associated integrity photos from the unified photos table
 * (entity_type = 'SKU', entity_id = sku.id).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tracking = searchParams.get('tracking')?.trim();

  if (!tracking) {
    return NextResponse.json({ found: false, error: 'tracking is required' }, { status: 400 });
  }

  try {
    const resolved = await resolveShipmentId(tracking);
    const result = await pool.query<{
      id: number;
      static_sku: string | null;
      serial_number: string | null;
      shipping_tracking_number: string | null;
      shipment_id: number | null;
      notes: string | null;
      location: string | null;
      created_at: string | null;
      updated_at: string | null;
      product_title: string | null;
      photos: string[];
    }>(
      `SELECT
         s.id,
         s.static_sku,
         s.serial_number,
         s.shipping_tracking_number,
         s.shipment_id,
         s.notes,
         s.location,
         s.created_at,
         s.updated_at,
         ss.product_title,
         COALESCE(
           ARRAY_AGG(p.url ORDER BY p.created_at ASC)
             FILTER (WHERE p.url IS NOT NULL),
           ARRAY[]::text[]
         ) AS photos
       FROM v_sku s
       LEFT JOIN sku_stock ss
         ON regexp_replace(UPPER(TRIM(COALESCE(ss.sku, ''))), '^0+', '') =
            regexp_replace(UPPER(TRIM(split_part(COALESCE(s.static_sku, ''), ':', 1))), '^0+', '')
       LEFT JOIN photos p
         ON p.entity_type = 'SKU' AND p.entity_id = s.id
       WHERE ($1::bigint IS NOT NULL AND s.shipment_id = $1)
          OR BTRIM(COALESCE(s.shipping_tracking_number, '')) = BTRIM($2)
       GROUP BY s.id, ss.product_title
       ORDER BY
         CASE
           WHEN $1::bigint IS NOT NULL AND s.shipment_id = $1 THEN 0
           WHEN BTRIM(COALESCE(s.shipping_tracking_number, '')) = BTRIM($2) THEN 1
           ELSE 2
         END,
         s.updated_at DESC NULLS LAST,
         s.id DESC
       LIMIT 1`,
      [resolved.shipmentId ?? null, tracking],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ found: false });
    }

    const row = result.rows[0];
    return NextResponse.json({
      found: true,
      sku: {
        id: row.id,
        static_sku: row.static_sku,
        serial_number: row.serial_number,
        shipping_tracking_number: row.shipping_tracking_number,
        shipment_id: row.shipment_id,
        notes: row.notes,
        location: row.location,
        created_at: row.created_at,
        updated_at: row.updated_at,
        product_title: row.product_title,
        photos: Array.isArray(row.photos) ? row.photos : [],
      },
    });
  } catch (err: any) {
    console.error('[sku/by-tracking] error:', err);
    return NextResponse.json(
      { found: false, error: 'Failed to look up SKU by tracking' },
      { status: 500 },
    );
  }
}
