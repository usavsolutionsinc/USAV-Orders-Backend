import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── POST /api/fba/labels/bind ─────────────────────────────────────────────────
// Packer scans a shipping label barcode, then binds one or more FNSKUs to it.
// Creates or reuses a fba_label_batches row, creates fba_label_batch_items rows,
// and transitions bound items from READY_TO_GO → LABEL_ASSIGNED.
// All operations run in a single transaction.
//
// Body: { shipment_id, label_barcode, fnskus: string[], staff_id, station? }
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { shipment_id, label_barcode, fnskus = [], staff_id, station } = body;

    if (!shipment_id || !label_barcode?.trim() || !staff_id) {
      return NextResponse.json(
        { success: false, error: 'shipment_id, label_barcode, and staff_id are required' },
        { status: 400 }
      );
    }
    if (!Array.isArray(fnskus) || fnskus.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one fnsku is required' }, { status: 400 });
    }

    await client.query('BEGIN');

    // Verify staff
    const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
    if (!staffCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    // Verify shipment
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

    // Upsert label batch
    const batchRes = await client.query(
      `INSERT INTO fba_label_batches (shipment_id, label_barcode, labeled_by_staff_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (shipment_id, label_barcode) DO UPDATE
         SET updated_at = NOW()
       RETURNING *`,
      [shipment_id, label_barcode.trim(), staff_id]
    );
    const batch = batchRes.rows[0];

    const boundItems: unknown[] = [];
    const errors: string[] = [];

    for (const rawFnsku of fnskus) {
      const fnsku = String(rawFnsku || '').trim();
      if (!fnsku) continue;

      // Find the item — must exist and be READY_TO_GO (or already LABEL_ASSIGNED for re-bind)
      const itemRes = await client.query(
        `SELECT * FROM fba_shipment_items WHERE shipment_id = $1 AND fnsku = $2`,
        [shipment_id, fnsku]
      );

      if (!itemRes.rows[0]) {
        errors.push(`FNSKU ${fnsku} not found in shipment`);
        continue;
      }

      const item = itemRes.rows[0];
      if (item.status === 'PLANNED') {
        errors.push(`FNSKU ${fnsku} is not yet ready (still PLANNED)`);
        continue;
      }
      if (item.status === 'SHIPPED') {
        errors.push(`FNSKU ${fnsku} is already shipped`);
        continue;
      }

      // Bind to batch (idempotent)
      await client.query(
        `INSERT INTO fba_label_batch_items (batch_id, item_id, qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (batch_id, item_id) DO UPDATE SET qty = EXCLUDED.qty`,
        [batch.id, item.id, item.actual_qty > 0 ? item.actual_qty : 1]
      );

      // Advance status to LABEL_ASSIGNED
      const updatedRes = await client.query(
        `UPDATE fba_shipment_items
         SET status            = 'LABEL_ASSIGNED',
             labeled_by_staff_id = $1,
             labeled_at        = NOW(),
             updated_at        = NOW()
         WHERE id = $2
         RETURNING *`,
        [staff_id, item.id]
      );

      // Audit event
      await client.query(
        `INSERT INTO fba_scan_events
           (shipment_id, item_id, batch_id, scanned_by_staff_id, scan_mode, event_type, fnsku, station)
         VALUES ($1, $2, $3, $4, 'LABEL_BIND', 'LABEL_BOUND', $5, $6)`,
        [shipment_id, item.id, batch.id, staff_id, fnsku, station || null]
      );

      boundItems.push(updatedRes.rows[0]);
    }

    // Roll up shipment status: advance to LABEL_ASSIGNED if no items remain READY_TO_GO or PLANNED
    await client.query(
      `UPDATE fba_shipments
       SET status     = 'LABEL_ASSIGNED',
           updated_at = NOW()
       WHERE id = $1
         AND status IN ('PLANNED','READY_TO_GO')
         AND NOT EXISTS (
           SELECT 1 FROM fba_shipment_items
           WHERE shipment_id = $1 AND status IN ('PLANNED','READY_TO_GO')
         )`,
      [shipment_id]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      batch,
      bound_items: boundItems,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/labels/bind]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to bind label' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
