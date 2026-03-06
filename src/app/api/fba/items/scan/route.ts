import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── POST /api/fba/items/scan ──────────────────────────────────────────────────
// Universal FNSKU scan used by StationPacking.
// Looks up the FNSKU in active fba_shipment_items:
//   - Found   → increment actual_qty, advance to READY_TO_GO, write audit event
//   - Not found → lookup product from fba_fnskus, write fba_scan_events with no
//                 item_id so there is still an audit trail (is_new=true)
//
// Body: { fnsku, staff_id, station? }
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { fnsku, staff_id, station } = body;

    if (!fnsku?.trim() || !staff_id) {
      return NextResponse.json({ success: false, error: 'fnsku and staff_id are required' }, { status: 400 });
    }

    await client.query('BEGIN');

    // Verify staff
    const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
    if (!staffCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    // Check if fba_shipment_items table exists yet (pre-migration safety)
    const tableCheck = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fba_shipment_items') AS exists`
    );

    if (!tableCheck.rows[0]?.exists) {
      // Fall through to legacy fba_fnskus lookup only
      await client.query('ROLLBACK');
      const legacyLookup = await pool.query(
        `SELECT product_title, asin, sku FROM fba_fnskus
         WHERE UPPER(TRIM(COALESCE(fnsku,''))) = UPPER(TRIM($1))
         LIMIT 1`,
        [fnsku.trim()]
      );
      const meta = legacyLookup.rows[0];
      return NextResponse.json({
        success: true,
        fnsku: fnsku.trim(),
        product_title: meta?.product_title || null,
        asin: meta?.asin || null,
        sku: meta?.sku || null,
        is_new: true,
        shipment_ref: null,
        actual_qty: 0,
        expected_qty: 0,
        status: 'READY_TO_GO',
      });
    }

    // Look for an active (non-SHIPPED) item in any open shipment
    const itemRes = await client.query(
      `SELECT fsi.*, fs.shipment_ref, fs.id AS fba_shipment_id
       FROM fba_shipment_items fsi
       JOIN fba_shipments fs ON fs.id = fsi.shipment_id
       WHERE UPPER(TRIM(fsi.fnsku)) = UPPER(TRIM($1))
         AND fs.status != 'SHIPPED'
         AND fsi.status != 'SHIPPED'
       ORDER BY
         CASE fsi.status
           WHEN 'READY_TO_GO' THEN 1
           WHEN 'PLANNED'     THEN 2
           ELSE 3
         END,
         fs.created_at DESC
       LIMIT 1`,
      [fnsku.trim()]
    );

    if (itemRes.rows[0]) {
      // ── Found in active plan → increment qty, advance status ──────────────
      const item = itemRes.rows[0];

      const updatedRes = await client.query(
        `UPDATE fba_shipment_items
         SET actual_qty        = actual_qty + 1,
             status            = CASE
                                   WHEN status = 'PLANNED' THEN 'READY_TO_GO'::fba_shipment_status_enum
                                   ELSE status
                                 END,
             ready_by_staff_id = COALESCE(ready_by_staff_id, $1),
             ready_at          = COALESCE(ready_at, NOW()),
             updated_at        = NOW()
         WHERE id = $2
         RETURNING *`,
        [staff_id, item.id]
      );

      await client.query(
        `INSERT INTO fba_scan_events
           (shipment_id, item_id, scanned_by_staff_id, scan_mode, event_type, fnsku, station)
         VALUES ($1, $2, $3, 'PACKER_VERIFY', 'PACK_VERIFIED', $4, $5)`,
        [item.fba_shipment_id, item.id, staff_id, fnsku.trim(), station || null]
      );

      // Roll up shipment status
      await client.query(
        `UPDATE fba_shipments
         SET status = 'READY_TO_GO', updated_at = NOW()
         WHERE id = $1 AND status = 'PLANNED'
           AND NOT EXISTS (
             SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED'
           )`,
        [item.fba_shipment_id]
      );

      await client.query('COMMIT');

      const updated = updatedRes.rows[0];
      return NextResponse.json({
        success: true,
        is_new: false,
        fnsku: updated.fnsku,
        product_title: updated.product_title,
        asin: updated.asin,
        sku: updated.sku,
        shipment_ref: item.shipment_ref,
        actual_qty: updated.actual_qty,
        expected_qty: updated.expected_qty,
        status: updated.status,
      });
    }

    // ── Not in any active plan → lookup from fba_fnskus + write orphan event ─
    const lookup = await client.query(
      `SELECT product_title, asin, sku FROM fba_fnskus
       WHERE UPPER(TRIM(COALESCE(fnsku,''))) = UPPER(TRIM($1))
       LIMIT 1`,
      [fnsku.trim()]
    );
    const meta = lookup.rows[0];

    // Write an orphan FNSKU_SCANNED audit event (no item_id / shipment_id)
    await client.query(
      `INSERT INTO fba_scan_events
         (scanned_by_staff_id, scan_mode, event_type, fnsku, station, metadata)
       VALUES ($1, 'PACKER_VERIFY', 'FNSKU_SCANNED', $2, $3, $4)`,
      [
        staff_id,
        fnsku.trim(),
        station || null,
        JSON.stringify({ source: 'pack_station_no_plan', product_title: meta?.product_title || null }),
      ]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      is_new: true,
      fnsku: fnsku.trim(),
      product_title: meta?.product_title || null,
      asin: meta?.asin || null,
      sku: meta?.sku || null,
      shipment_ref: null,
      actual_qty: 0,
      expected_qty: 0,
      status: 'READY_TO_GO',
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
