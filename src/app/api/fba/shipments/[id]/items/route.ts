import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getInvalidFbaPlanIdMessage, parseFbaPlanId } from '@/lib/fba/plan-id';

// â”€â”€ GET /api/fba/shipments/[id]/items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns all items for a specific FBA shipment with staff names joined.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const shipmentId = parseFbaPlanId(id);
    if (shipmentId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         fsi.id,
         fsi.fnsku,
         COALESCE(fsi.product_title, ff.product_title, fsi.fnsku) AS display_title,
         fsi.product_title,
         fsi.asin,
         fsi.sku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status,
         fsi.notes,
         fsi.ready_by_staff_id,
         fsi.verified_by_staff_id,
         fsi.labeled_by_staff_id,
         fsi.shipped_by_staff_id,
         fsi.ready_at,
         fsi.verified_at,
         fsi.labeled_at,
         fsi.shipped_at,
         r.name  AS ready_by_name,
         v.name  AS verified_by_name,
         l.name  AS labeled_by_name,
         sh.name AS shipped_by_name
       FROM fba_shipment_items fsi
       LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku
       LEFT JOIN staff r  ON r.id  = fsi.ready_by_staff_id
       LEFT JOIN staff v  ON v.id  = fsi.verified_by_staff_id
       LEFT JOIN staff l  ON l.id  = fsi.labeled_by_staff_id
       LEFT JOIN staff sh ON sh.id = fsi.shipped_by_staff_id
       WHERE fsi.shipment_id = $1
       ORDER BY fsi.status DESC, fsi.fnsku`,
      [shipmentId]
    );

    return NextResponse.json({ success: true, items: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]/items]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch items' },
      { status: 500 }
    );
  }
}

// â”€â”€ POST /api/fba/shipments/[id]/items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Add (or upsert) an item to an existing shipment.
// Pulls product metadata from fba_fnskus if product_title is not provided.
// Body: { fnsku, expected_qty?, product_title?, asin?, sku? }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect();
  try {
    const { id } = await params;
    const shipmentId = parseFbaPlanId(id);
    if (shipmentId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const body = await request.json();
    const fnsku = String(body?.fnsku || '').trim().toUpperCase();
    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const expectedQty = Math.max(0, Number(body?.expected_qty) || 0);

    await client.query('BEGIN');

    const shipmentCheck = await client.query(
      `SELECT id, status FROM fba_shipments WHERE id = $1`,
      [shipmentId]
    );
    if (!shipmentCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 });
    }
    if (shipmentCheck.rows[0].status === 'SHIPPED') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'Cannot add items to a shipped shipment' },
        { status: 409 }
      );
    }

    // Pull metadata from fba_fnskus if not provided
    let productTitle = body?.product_title || null;
    let asin = body?.asin || null;
    let sku = body?.sku || null;

    if (!productTitle) {
      const lookup = await client.query(
        `SELECT product_title, asin, sku FROM fba_fnskus WHERE fnsku = $1 LIMIT 1`,
        [fnsku]
      );
      if (lookup.rows[0]) {
        productTitle = lookup.rows[0].product_title;
        asin = asin || lookup.rows[0].asin;
        sku = sku || lookup.rows[0].sku;
      }
    }

    const result = await client.query(
      `INSERT INTO fba_shipment_items
         (shipment_id, fnsku, product_title, asin, sku, expected_qty)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (shipment_id, fnsku) DO UPDATE
         SET expected_qty  = EXCLUDED.expected_qty,
             product_title = COALESCE(EXCLUDED.product_title, fba_shipment_items.product_title),
             asin          = COALESCE(EXCLUDED.asin, fba_shipment_items.asin),
             sku           = COALESCE(EXCLUDED.sku, fba_shipment_items.sku),
             updated_at    = NOW()
       RETURNING *`,
      [shipmentId, fnsku, productTitle, asin, sku, expectedQty]
    );

    await client.query('COMMIT');

    return NextResponse.json({ success: true, item: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments/[id]/items]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to add shipment item' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

