import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── POST /api/fba/items/verify ────────────────────────────────────────────────
// Packer confirms a READY_TO_GO item is physically present (PACKER_VERIFIED).
// Records verified_by_staff_id + verified_at without changing the status enum
// (status transitions to LABEL_ASSIGNED only when a label is bound).
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

    // Find the item — must be READY_TO_GO or LABEL_ASSIGNED
    const itemRes = await client.query(
      `SELECT * FROM fba_shipment_items
       WHERE shipment_id = $1 AND fnsku = $2`,
      [shipment_id, fnsku.trim()]
    );

    if (!itemRes.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: `FNSKU ${fnsku} not found in shipment ${shipment_id}` },
        { status: 404 }
      );
    }

    const item = itemRes.rows[0];
    if (item.status === 'PLANNED') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'Item must be READY_TO_GO before packer verification' },
        { status: 409 }
      );
    }
    if (item.status === 'SHIPPED') {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Item is already shipped' }, { status: 409 });
    }

    // Record verification (idempotent — only set if not already set)
    const updatedRes = await client.query(
      `UPDATE fba_shipment_items
       SET verified_by_staff_id = COALESCE(verified_by_staff_id, $1),
           verified_at          = COALESCE(verified_at, NOW()),
           updated_at           = NOW()
       WHERE id = $2
       RETURNING *`,
      [staff_id, item.id]
    );

    // Write audit event
    const eventRes = await client.query(
      `INSERT INTO fba_scan_events
         (shipment_id, item_id, scanned_by_staff_id, scan_mode, event_type, fnsku, station)
       VALUES ($1, $2, $3, 'PACKER_VERIFY', 'PACK_VERIFIED', $4, $5)
       RETURNING id, created_at`,
      [shipment_id, item.id, staff_id, fnsku.trim(), station || null]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      item: updatedRes.rows[0],
      event: eventRes.rows[0],
      staff_name: staffCheck.rows[0].name,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/items/verify]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to verify item' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
