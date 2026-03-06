import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── GET /api/fba/shipments ────────────────────────────────────────────────────
// Returns shipments with aggregated item counts and staff names.
// Query params: status (comma-separated), limit, q (search shipment_ref / notes)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get('q') || '').trim();
    const statusParam = String(searchParams.get('status') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 100;

    const statusValues = statusParam
      ? statusParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];

    // Build dynamic WHERE clauses
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (statusValues.length > 0) {
      conditions.push(`fs.status = ANY($${idx}::fba_shipment_status_enum[])`);
      params.push(statusValues);
      idx++;
    }
    if (q) {
      conditions.push(`(fs.shipment_ref ILIKE $${idx} OR fs.notes ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit);
    const limitIdx = idx;

    const query = `
      SELECT
        fs.id,
        fs.shipment_ref,
        fs.destination_fc,
        fs.due_date,
        fs.status,
        fs.notes,
        fs.shipped_at,
        fs.created_at,
        fs.updated_at,
        -- Staff names
        creator.name   AS created_by_name,
        tech.name      AS assigned_tech_name,
        packer.name    AS assigned_packer_name,
        fs.created_by_staff_id,
        fs.assigned_tech_id,
        fs.assigned_packer_id,
        -- Item aggregates
        COUNT(fsi.id)                                              AS total_items,
        COUNT(fsi.id) FILTER (WHERE fsi.status = 'READY_TO_GO')   AS ready_items,
        COUNT(fsi.id) FILTER (WHERE fsi.status = 'LABEL_ASSIGNED') AS labeled_items,
        COUNT(fsi.id) FILTER (WHERE fsi.status = 'SHIPPED')        AS shipped_items,
        COALESCE(SUM(fsi.expected_qty), 0)                         AS total_expected_qty,
        COALESCE(SUM(fsi.actual_qty), 0)                           AS total_actual_qty
      FROM fba_shipments fs
      LEFT JOIN staff creator ON creator.id = fs.created_by_staff_id
      LEFT JOIN staff tech    ON tech.id    = fs.assigned_tech_id
      LEFT JOIN staff packer  ON packer.id  = fs.assigned_packer_id
      LEFT JOIN fba_shipment_items fsi ON fsi.shipment_id = fs.id
      ${whereClause}
      GROUP BY fs.id, creator.name, tech.name, packer.name
      ORDER BY fs.created_at DESC
      LIMIT $${limitIdx}
    `;

    const result = await pool.query(query, params);
    return NextResponse.json({ success: true, shipments: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA shipments' },
      { status: 500 }
    );
  }
}

// ── POST /api/fba/shipments ───────────────────────────────────────────────────
// Creates a shipment header + optional initial items in a single transaction.
// Body: { shipment_ref, destination_fc?, due_date?, notes?,
//         created_by_staff_id, assigned_tech_id?, assigned_packer_id?,
//         items: [{ fnsku, expected_qty, product_title?, asin?, sku? }] }
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const {
      shipment_ref,
      destination_fc,
      due_date,
      notes,
      created_by_staff_id,
      assigned_tech_id,
      assigned_packer_id,
      items = [],
    } = body;

    if (!shipment_ref?.trim()) {
      return NextResponse.json({ success: false, error: 'shipment_ref is required' }, { status: 400 });
    }
    if (!created_by_staff_id) {
      return NextResponse.json({ success: false, error: 'created_by_staff_id is required' }, { status: 400 });
    }

    await client.query('BEGIN');

    const shipmentRes = await client.query(
      `INSERT INTO fba_shipments
         (shipment_ref, destination_fc, due_date, notes,
          created_by_staff_id, assigned_tech_id, assigned_packer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        shipment_ref.trim(),
        destination_fc || null,
        due_date || null,
        notes || null,
        created_by_staff_id,
        assigned_tech_id || null,
        assigned_packer_id || null,
      ]
    );

    const shipment = shipmentRes.rows[0];
    const insertedItems: unknown[] = [];

    for (const item of items) {
      if (!item.fnsku?.trim()) continue;

      // Try to pull product metadata from fba_fnskus if not provided
      let productTitle = item.product_title || null;
      let asin = item.asin || null;
      let sku = item.sku || null;

      if (!productTitle) {
        const lookup = await client.query(
          `SELECT product_title, asin, sku FROM fba_fnskus
           WHERE UPPER(TRIM(COALESCE(fnsku,''))) = UPPER(TRIM($1))
           LIMIT 1`,
          [item.fnsku.trim()]
        );
        if (lookup.rows[0]) {
          productTitle = lookup.rows[0].product_title;
          asin = lookup.rows[0].asin;
          sku = lookup.rows[0].sku;
        }
      }

      const itemRes = await client.query(
        `INSERT INTO fba_shipment_items
           (shipment_id, fnsku, product_title, asin, sku, expected_qty)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (shipment_id, fnsku) DO UPDATE
           SET expected_qty = EXCLUDED.expected_qty,
               updated_at   = NOW()
         RETURNING *`,
        [shipment.id, item.fnsku.trim(), productTitle, asin, sku, Math.max(0, Number(item.expected_qty) || 0)]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    await client.query('COMMIT');

    return NextResponse.json({ success: true, shipment, items: insertedItems }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to create FBA shipment' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
