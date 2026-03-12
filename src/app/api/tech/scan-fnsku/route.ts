import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fnskuParam = searchParams.get('fnsku');
  const techId = searchParams.get('techId');

  if (!fnskuParam) {
    return NextResponse.json({ error: 'FNSKU is required' }, { status: 400 });
  }

  if (!techId) {
    return NextResponse.json({ error: 'Tech ID is required' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const fnsku = fnskuParam.trim().toUpperCase();
    const techIdNum = parseInt(techId, 10);
    if (!techIdNum) {
      return NextResponse.json({ error: 'Invalid Tech ID' }, { status: 400 });
    }

    await client.query('BEGIN');

    const staffResult = await client.query(
      `SELECT id FROM staff WHERE id = $1 LIMIT 1`,
      [techIdNum]
    );
    if (staffResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Tech not found in staff table' }, { status: 404 });
    }
    const testedBy = staffResult.rows[0].id as number;

    const fnskuResult = await client.query(
      `SELECT fnsku, product_title, asin, sku
       FROM fba_fnskus
       WHERE fnsku = $1
       LIMIT 1`,
      [fnsku]
    );

    if (fnskuResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ found: false, error: 'FNSKU not found in fba_fnskus table' });
    }

    const meta = fnskuResult.rows[0];

    const techLogResult = await client.query(
      `INSERT INTO tech_serial_numbers
         (serial_number, serial_type, tested_by, scan_ref, fnsku, notes)
       VALUES ($1, 'FNSKU', $2, $3, $3, $4)
       RETURNING id`,
      [null, testedBy, fnsku, 'Tech FNSKU scan']
    );
    const techSerialId = Number(techLogResult.rows[0].id);

    const openItemResult = await client.query(
      `SELECT
         fsi.id,
         fsi.shipment_id,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status,
         fs.shipment_ref
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
      [fnsku]
    );
    const openItem = openItemResult.rows[0] ?? null;

    const fnskuLogResult = await client.query(
      `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id, tech_serial_number_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
       VALUES ($1, 'TECH', 'SCANNED', $2, $3, $4, $5, 1, 'TECH_STATION', $6, $7::jsonb)
       RETURNING id, created_at`,
      [
        fnsku,
        testedBy,
        techSerialId,
        openItem?.shipment_id ?? null,
        openItem?.id ?? null,
        'Tech FNSKU scan',
        JSON.stringify({
          product_title: meta.product_title ?? null,
          sku: meta.sku ?? null,
          asin: meta.asin ?? null,
          auto_linked_open_item: Boolean(openItem),
        }),
      ]
    );

    await client.query(
      `UPDATE tech_serial_numbers
       SET fnsku_log_id = $1,
           fba_shipment_id = $2,
           fba_shipment_item_id = $3
       WHERE id = $4`,
      [fnskuLogResult.rows[0].id, openItem?.shipment_id ?? null, openItem?.id ?? null, techSerialId]
    );

    const serialsResult = await client.query(
      `SELECT serial_number
       FROM tech_serial_numbers
       WHERE fnsku = $1
         AND serial_number IS NOT NULL
         AND BTRIM(serial_number) <> ''
       ORDER BY test_date_time ASC, id ASC`,
      [fnsku]
    );

    const summaryResult = await client.query(
      `SELECT
         COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'TECH' AND event_type = 'SCANNED'), 0)::int AS tech_scanned_qty,
         COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'PACK' AND event_type IN ('READY', 'VERIFIED', 'BOXED')), 0)::int AS pack_ready_qty,
         COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'SHIP' AND event_type = 'SHIPPED'), 0)::int AS shipped_qty
       FROM fba_fnsku_logs
       WHERE fnsku = $1
         AND event_type != 'VOID'`,
      [fnsku]
    );

    await client.query('COMMIT');
    await invalidateCacheTags(['tech-logs', 'orders-next']);

    const summary = summaryResult.rows[0] || {
      tech_scanned_qty: 0,
      pack_ready_qty: 0,
      shipped_qty: 0,
    };
    const techScannedQty = Number(summary.tech_scanned_qty || 0);
    const packReadyQty = Number(summary.pack_ready_qty || 0);
    const shippedQty = Number(summary.shipped_qty || 0);

    return NextResponse.json({
      found: true,
      orderFound: false,
      techSerialId,
      fnskuLogId: Number(fnskuLogResult.rows[0].id),
      summary: {
        tech_scanned_qty: techScannedQty,
        pack_ready_qty: packReadyQty,
        shipped_qty: shippedQty,
        available_to_ship: Math.max(Math.min(techScannedQty, packReadyQty) - shippedQty, 0),
      },
      shipment: openItem
        ? {
            shipment_id: Number(openItem.shipment_id),
            shipment_ref: openItem.shipment_ref ?? null,
            item_id: Number(openItem.id),
            expected_qty: Number(openItem.expected_qty || 0),
            actual_qty: Number(openItem.actual_qty || 0),
            status: openItem.status,
          }
        : null,
      order: {
        id: null,
        orderId: 'FNSKU',
        productTitle: meta.product_title || 'Unknown Product',
        itemNumber: null,
        sku: meta.sku || 'N/A',
        condition: 'N/A',
        notes: '',
        tracking: fnsku,
        serialNumbers: serialsResult.rows.map((r: { serial_number: string | null }) => r.serial_number).filter(Boolean),
        testDateTime: fnskuLogResult.rows[0].created_at,
        testedBy,
        accountSource: 'fba',
        quantity: 1,
        status: openItem?.status || null,
        statusHistory: [],
        isShipped: false,
        packerId: null,
        testerId: null,
        outOfStock: null,
        asin: meta.asin || null,
        shipByDate: null,
        orderDate: null,
        createdAt: fnskuLogResult.rows[0].created_at,
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error scanning FNSKU:', error);
    return NextResponse.json(
      {
        error: 'Failed to scan FNSKU',
        details: error.message,
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
