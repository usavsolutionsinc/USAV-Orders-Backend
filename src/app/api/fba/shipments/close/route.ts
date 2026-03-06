import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── POST /api/fba/shipments/close ─────────────────────────────────────────────
// Ship Close: transitions all LABEL_ASSIGNED items (and any remaining
// READY_TO_GO items) to SHIPPED and marks the shipment as SHIPPED.
// Requires all items to be at least READY_TO_GO (admin can force-close).
// Writes a SHIPMENT_CLOSED audit event for each item.
//
// Body: { shipment_id, staff_id, force?: boolean, station? }
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { shipment_id, staff_id, force = false, station } = body;

    if (!shipment_id || !staff_id) {
      return NextResponse.json(
        { success: false, error: 'shipment_id and staff_id are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Verify staff
    const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
    if (!staffCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    // Verify shipment exists
    const shipmentCheck = await client.query(
      `SELECT id, status, shipment_ref FROM fba_shipments WHERE id = $1`,
      [shipment_id]
    );
    if (!shipmentCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 });
    }
    if (shipmentCheck.rows[0].status === 'SHIPPED') {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Shipment is already shipped' }, { status: 409 });
    }

    // Block close if any items are still PLANNED (unless force=true by admin)
    if (!force) {
      const plannedCount = await client.query(
        `SELECT COUNT(*) FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED'`,
        [shipment_id]
      );
      if (Number(plannedCount.rows[0].count) > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            success: false,
            error: `${plannedCount.rows[0].count} item(s) are still PLANNED. Mark them ready first or use force=true.`,
          },
          { status: 409 }
        );
      }
    }

    // Ship all non-shipped items
    const itemsRes = await client.query(
      `UPDATE fba_shipment_items
       SET status            = 'SHIPPED',
           shipped_by_staff_id = $1,
           shipped_at        = NOW(),
           updated_at        = NOW()
       WHERE shipment_id = $2
         AND status != 'SHIPPED'
       RETURNING *`,
      [staff_id, shipment_id]
    );

    // Write one audit event per shipped item
    for (const item of itemsRes.rows) {
      await client.query(
        `INSERT INTO fba_scan_events
           (shipment_id, item_id, scanned_by_staff_id, scan_mode, event_type, fnsku, station)
         VALUES ($1, $2, $3, 'SHIP_CLOSE', 'SHIPMENT_CLOSED', $4, $5)`,
        [shipment_id, item.id, staff_id, item.fnsku, station || null]
      );
    }

    // Mark the label batches as SHIPPED
    await client.query(
      `UPDATE fba_label_batches SET status = 'SHIPPED', updated_at = NOW() WHERE shipment_id = $1`,
      [shipment_id]
    );

    // Close the shipment
    const closedShipmentRes = await client.query(
      `UPDATE fba_shipments
       SET status     = 'SHIPPED',
           shipped_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [shipment_id]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      shipment: closedShipmentRes.rows[0],
      items_shipped: itemsRes.rows.length,
      staff_name: staffCheck.rows[0].name,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments/close]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to close shipment' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
