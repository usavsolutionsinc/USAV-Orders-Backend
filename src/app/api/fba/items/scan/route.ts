import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createStationActivityLog } from '@/lib/station-activity';

// Pack-station FNSKU scan.
// Writes into the shared fba_fnsku_logs ledger and, when an open shipment item
// exists, increments the shipment item's actual_qty and advances it to READY_TO_GO.
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { fnsku, staff_id, station } = body;

    if (!fnsku?.trim() || !staff_id) {
      return NextResponse.json({ success: false, error: 'fnsku and staff_id are required' }, { status: 400 });
    }

    const normalizedFnsku = String(fnsku).trim().toUpperCase();

    await client.query('BEGIN');

    const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
    if (!staffCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    const metaRes = await client.query(
      `SELECT fnsku, product_title, asin, sku
       FROM fba_fnskus
       WHERE fnsku = $1
       LIMIT 1`,
      [normalizedFnsku]
    );

    if (!metaRes.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: `FNSKU ${normalizedFnsku} not found in fba_fnskus` }, { status: 404 });
    }
    const meta = metaRes.rows[0];

    const itemRes = await client.query(
      `SELECT
         fsi.*,
         fs.shipment_ref,
         fs.status AS shipment_status
       FROM fba_shipment_items fsi
       JOIN fba_shipments fs ON fs.id = fsi.shipment_id
       WHERE fsi.fnsku = $1
         AND fs.status != 'SHIPPED'
         AND fsi.status != 'SHIPPED'
       ORDER BY
         CASE fsi.status
           WHEN 'PLANNED' THEN 1
           WHEN 'READY_TO_GO' THEN 2
           WHEN 'LABEL_ASSIGNED' THEN 3
           ELSE 4
         END,
         fs.created_at ASC,
         fsi.id ASC
       LIMIT 1`,
      [normalizedFnsku]
    );

    const openItem = itemRes.rows[0] ?? null;
    let updatedItem = openItem;

    if (openItem) {
      const updatedRes = await client.query(
        `UPDATE fba_shipment_items
         SET actual_qty = actual_qty + 1,
             status = CASE
                        WHEN status = 'PLANNED' THEN 'READY_TO_GO'::fba_shipment_status_enum
                        ELSE status
                      END,
             ready_by_staff_id = COALESCE(ready_by_staff_id, $1),
             ready_at = COALESCE(ready_at, NOW()),
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [staff_id, openItem.id]
      );
      updatedItem = updatedRes.rows[0];

      await client.query(
        `UPDATE fba_shipments fs
         SET ready_item_count = counts.ready_item_count,
             packed_item_count = counts.packed_item_count,
             shipped_item_count = counts.shipped_item_count,
             status = CASE
                        WHEN fs.status = 'PLANNED' AND counts.planned_item_count = 0 THEN 'READY_TO_GO'::fba_shipment_status_enum
                        ELSE fs.status
                      END,
             updated_at = NOW()
         FROM (
           SELECT
             shipment_id,
             COUNT(*) FILTER (WHERE status IN ('READY_TO_GO', 'LABEL_ASSIGNED', 'SHIPPED'))::int AS ready_item_count,
             COUNT(*) FILTER (WHERE status IN ('LABEL_ASSIGNED', 'SHIPPED'))::int AS packed_item_count,
             COUNT(*) FILTER (WHERE status = 'SHIPPED')::int AS shipped_item_count,
             COUNT(*) FILTER (WHERE status = 'PLANNED')::int AS planned_item_count
           FROM fba_shipment_items
           WHERE shipment_id = $1
           GROUP BY shipment_id
         ) counts
         WHERE fs.id = counts.shipment_id`,
        [openItem.shipment_id]
      );
    }

    const fnskuLogRes = await client.query(
      `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
       VALUES ($1, 'PACK', 'READY', $2, $3, $4, 1, $5, $6, $7::jsonb)
       RETURNING id, created_at`,
      [
        normalizedFnsku,
        staff_id,
        updatedItem?.shipment_id ?? null,
        updatedItem?.id ?? null,
        station || 'PACK_STATION',
        openItem ? 'Pack station scan matched open shipment item' : 'Pack station scan without open shipment item',
        JSON.stringify({
          product_title: meta.product_title ?? null,
          sku: meta.sku ?? null,
          asin: meta.asin ?? null,
          matched_open_item: Boolean(openItem),
        }),
      ]
    );

    await createStationActivityLog(client, {
      station: 'PACK',
      activityType: 'FBA_READY',
      staffId: Number(staff_id),
      scanRef: normalizedFnsku,
      fnsku: normalizedFnsku,
      fbaShipmentId: updatedItem?.shipment_id ?? null,
      fbaShipmentItemId: updatedItem?.id ?? null,
      notes: openItem ? 'Pack station FNSKU ready scan' : 'Pack station FNSKU scan without open item',
      metadata: {
        fnsku_log_id: Number(fnskuLogRes.rows[0].id),
        product_title: meta.product_title ?? null,
        sku: meta.sku ?? null,
        quantity: 1,
      },
    });

    const summaryRes = await client.query(
      `SELECT
         COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'TECH' AND event_type = 'SCANNED'), 0)::int AS tech_scanned_qty,
         COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'PACK' AND event_type IN ('READY', 'VERIFIED', 'BOXED')), 0)::int AS pack_ready_qty,
         COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'SHIP' AND event_type = 'SHIPPED'), 0)::int AS shipped_qty
       FROM fba_fnsku_logs
       WHERE fnsku = $1
         AND event_type != 'VOID'`,
      [normalizedFnsku]
    );

    await client.query('COMMIT');

    const summary = summaryRes.rows[0] || {
      tech_scanned_qty: 0,
      pack_ready_qty: 0,
      shipped_qty: 0,
    };
    const techScannedQty = Number(summary.tech_scanned_qty || 0);
    const packReadyQty = Number(summary.pack_ready_qty || 0);
    const shippedQty = Number(summary.shipped_qty || 0);

    return NextResponse.json({
      success: true,
      fnsku: normalizedFnsku,
      fnsku_log_id: Number(fnskuLogRes.rows[0].id),
      product_title: meta.product_title || null,
      asin: meta.asin || null,
      sku: meta.sku || null,
      shipment_ref: openItem?.shipment_ref || null,
      shipment_id: updatedItem?.shipment_id ?? null,
      item_id: updatedItem?.id ?? null,
      actual_qty: updatedItem?.actual_qty ?? 0,
      expected_qty: updatedItem?.expected_qty ?? 0,
      status: updatedItem?.status || 'READY_TO_GO',
      is_new: !openItem,
      summary: {
        tech_scanned_qty: techScannedQty,
        pack_ready_qty: packReadyQty,
        shipped_qty: shippedQty,
        available_to_ship: Math.max(Math.min(techScannedQty, packReadyQty) - shippedQty, 0),
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/items/scan]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Scan failed' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
