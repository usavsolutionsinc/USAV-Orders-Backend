import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { detectCarrier } from '@/lib/tracking-format';

/**
 * POST /api/fba/shipments/mark-shipped
 *
 * Bulk-marks selected READY_TO_GO items as SHIPPED, links a UPS tracking
 * number to each affected shipment, and optionally stamps the Amazon
 * shipment ID on each parent fba_shipments row.
 *
 * Body:
 * {
 *   item_ids:           number[],  // fba_shipment_items.id[]
 *   tracking_number:    string,    // UPS / carrier tracking number
 *   amazon_shipment_id?: string,   // optional Amazon FBA shipment ID
 *   carrier?:           string,    // auto-detected if omitted
 * }
 *
 * After marking shipped:
 *  - If ALL items in a shipment are SHIPPED and actual_qty >= expected_qty,
 *    the shipment is DELETED (fully fulfilled).
 */
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const itemIds: number[] = Array.isArray(body.item_ids) ? body.item_ids.map(Number) : [];
    const rawTracking = String(body.tracking_number || '').trim().toUpperCase();
    const amazonShipmentId = body.amazon_shipment_id ? String(body.amazon_shipment_id).trim() : null;

    if (itemIds.length === 0) {
      return NextResponse.json({ success: false, error: 'item_ids is required' }, { status: 400 });
    }
    if (!rawTracking) {
      return NextResponse.json({ success: false, error: 'tracking_number is required' }, { status: 400 });
    }

    const carrier = String(body.carrier || detectCarrier(rawTracking)).toUpperCase();

    await client.query('BEGIN');

    // ── 1. Fetch items to know which shipments are affected ───────────────────
    const itemsRes = await client.query(
      `SELECT id, shipment_id, expected_qty, status
       FROM fba_shipment_items
       WHERE id = ANY($1::int[])`,
      [itemIds]
    );
    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'No matching items found' }, { status: 404 });
    }

    const shipmentIds = Array.from(new Set(itemsRes.rows.map((r) => r.shipment_id as number)));

    // ── 2. Mark each item as SHIPPED with actual_qty = expected_qty ───────────
    await client.query(
      `UPDATE fba_shipment_items
       SET status        = 'SHIPPED',
           actual_qty    = expected_qty,
           shipped_at    = NOW(),
           updated_at    = NOW()
       WHERE id = ANY($1::int[]) AND status = 'READY_TO_GO'`,
      [itemIds]
    );

    // ── 3. Upsert tracking number ─────────────────────────────────────────────
    const trackRes = await client.query(
      `INSERT INTO shipping_tracking_numbers
         (tracking_number_raw, tracking_number_normalized, carrier, source_system)
       VALUES ($1, $2, $3, 'fba')
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET source_system = COALESCE(shipping_tracking_numbers.source_system, EXCLUDED.source_system),
             updated_at    = NOW()
       RETURNING id, tracking_number_raw, carrier`,
      [rawTracking, rawTracking, carrier]
    );
    const trackingId = trackRes.rows[0].id as number;

    // ── 4. Link tracking to each affected shipment ────────────────────────────
    for (const shipId of shipmentIds) {
      await client.query(
        `INSERT INTO fba_shipment_tracking (shipment_id, tracking_id, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (shipment_id, tracking_id) DO NOTHING`,
        [shipId, trackingId, 'UPS']
      );
    }

    // ── 5. Optionally stamp amazon_shipment_id ────────────────────────────────
    if (amazonShipmentId) {
      await client.query(
        `UPDATE fba_shipments
         SET amazon_shipment_id = $1,
             updated_at         = NOW()
         WHERE id = ANY($2::int[])`,
        [amazonShipmentId, shipmentIds]
      );
    }

    // ── 6. Update shipped_item_count cache on each shipment ───────────────────
    for (const shipId of shipmentIds) {
      await client.query(
        `UPDATE fba_shipments
         SET shipped_item_count = (
               SELECT COUNT(*) FROM fba_shipment_items
               WHERE shipment_id = $1 AND status = 'SHIPPED'
             ),
             updated_at = NOW()
         WHERE id = $1`,
        [shipId]
      );
    }

    // ── 7. Auto-close shipments where all items are fully shipped ─────────────
    const deletedShipments: number[] = [];
    for (const shipId of shipmentIds) {
      const checkRes = await client.query(
        `SELECT
           COUNT(*)                                                   AS total,
           COUNT(*) FILTER (WHERE status = 'SHIPPED'
                              AND actual_qty >= expected_qty)         AS fully_shipped
         FROM fba_shipment_items
         WHERE shipment_id = $1`,
        [shipId]
      );
      const { total, fully_shipped } = checkRes.rows[0];
      if (Number(total) > 0 && Number(total) === Number(fully_shipped)) {
        await client.query(`DELETE FROM fba_shipments WHERE id = $1`, [shipId]);
        deletedShipments.push(shipId);
      }
    }

    await client.query('COMMIT');

    return NextResponse.json(
      {
        success: true,
        marked_shipped: itemsRes.rows.length,
        tracking_number: rawTracking,
        tracking_id: trackingId,
        carrier,
        affected_shipments: shipmentIds,
        deleted_shipments: deletedShipments,
      },
      { status: 200 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments/mark-shipped]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to mark items shipped' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

