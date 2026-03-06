import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── POST /api/fba/items/ready ─────────────────────────────────────────────────
// Tech marks an FNSKU item as READY_TO_GO after testing/validation.
// Increments actual_qty and transitions status PLANNED → READY_TO_GO.
// Writes to fba_scan_events in the same transaction.
//
// Body: { shipment_id, fnsku, staff_id, station? }
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { shipment_id, fnsku, staff_id, station } = body;

    if (!shipment_id || !fnsku?.trim() || !staff_id) {
      return NextResponse.json(
        { success: false, error: 'shipment_id, fnsku, and staff_id are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Verify staff exists
    const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
    if (!staffCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    // Verify shipment exists and is not already SHIPPED
    const shipmentCheck = await client.query(
      `SELECT id, status FROM fba_shipments WHERE id = $1`,
      [shipment_id]
    );
    if (!shipmentCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 });
    }
    if (shipmentCheck.rows[0].status === 'SHIPPED') {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Shipment is already closed' }, { status: 409 });
    }

    // Upsert the item (create if first scan, update if already exists)
    // Increment actual_qty and promote to READY_TO_GO
    const itemRes = await client.query(
      `INSERT INTO fba_shipment_items (shipment_id, fnsku, status, actual_qty, ready_by_staff_id, ready_at)
       VALUES ($1, $2, 'READY_TO_GO', 1, $3, NOW())
       ON CONFLICT (shipment_id, fnsku) DO UPDATE
         SET actual_qty         = fba_shipment_items.actual_qty + 1,
             status             = CASE
                                    WHEN fba_shipment_items.status = 'PLANNED' THEN 'READY_TO_GO'::fba_shipment_status_enum
                                    ELSE fba_shipment_items.status
                                  END,
             ready_by_staff_id  = COALESCE(fba_shipment_items.ready_by_staff_id, $3),
             ready_at           = COALESCE(fba_shipment_items.ready_at, NOW()),
             updated_at         = NOW()
       RETURNING *`,
      [shipment_id, fnsku.trim(), staff_id]
    );

    const item = itemRes.rows[0];

    // Write immutable audit event
    const eventRes = await client.query(
      `INSERT INTO fba_scan_events
         (shipment_id, item_id, scanned_by_staff_id, scan_mode, event_type, fnsku, station)
       VALUES ($1, $2, $3, 'TECH_PREP', 'READY_MARKED', $4, $5)
       RETURNING id, created_at`,
      [shipment_id, item.id, staff_id, fnsku.trim(), station || null]
    );

    // Roll up shipment status: if all items are READY_TO_GO (or beyond), advance shipment
    await client.query(
      `UPDATE fba_shipments
       SET status     = 'READY_TO_GO',
           updated_at = NOW()
       WHERE id = $1
         AND status = 'PLANNED'
         AND NOT EXISTS (
           SELECT 1 FROM fba_shipment_items
           WHERE shipment_id = $1 AND status = 'PLANNED'
         )`,
      [shipment_id]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      item,
      event: eventRes.rows[0],
      staff_name: staffCheck.rows[0].name,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/items/ready]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to mark item ready' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
