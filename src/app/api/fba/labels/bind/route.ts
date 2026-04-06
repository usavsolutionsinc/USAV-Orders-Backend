import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

// ── POST /api/fba/labels/bind ─────────────────────────────────────────────────
// Packer scans a shipping label barcode, then binds one or more FNSKUs to it.
// Transitions bound items from READY_TO_GO → LABEL_ASSIGNED and records
// immutable events in fba_fnsku_logs. All operations run in one transaction.
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
    const normalizedFnskus = Array.from(
      new Set(
        fnskus
          .map((value: unknown) => String(value || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
    if (normalizedFnskus.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one valid fnsku is required' }, { status: 400 });
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

    const boundItems: Array<Record<string, unknown>> = [];
    const errors: string[] = [];

    for (const fnsku of normalizedFnskus) {
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

      // Advance status to LABEL_ASSIGNED
      const updatedRes = await client.query(
        `UPDATE fba_shipment_items
         SET status            = 'LABEL_ASSIGNED',
             labeled_by_staff_id = COALESCE(labeled_by_staff_id, $1),
             labeled_at        = COALESCE(labeled_at, NOW()),
             updated_at        = NOW()
         WHERE id = $2
         RETURNING *`,
        [staff_id, item.id]
      );

      const logRes = await client.query(
        `INSERT INTO fba_fnsku_logs
           (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
         VALUES ($1, 'PACK', 'ASSIGNED', $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, created_at`,
        [
          fnsku,
          staff_id,
          shipment_id,
          item.id,
          Math.max(1, Number(item.actual_qty) || 0),
          station || 'LABEL_BIND',
          'Label barcode bound to shipment item',
          JSON.stringify({
            label_barcode: String(label_barcode).trim(),
            trigger: 'fba.labels.bind',
            previous_status: item.status,
          }),
        ]
      );

      boundItems.push({
        ...updatedRes.rows[0],
        log_id: Number(logRes.rows[0].id),
      });
    }

    // Auto-advance shipment status based on remaining item statuses.
    await client.query(
      `UPDATE fba_shipments
       SET status = CASE
                      WHEN NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED')
                        AND NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'READY_TO_GO')
                        THEN 'LABEL_ASSIGNED'::fba_shipment_status_enum
                      WHEN NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED')
                        THEN 'READY_TO_GO'::fba_shipment_status_enum
                      ELSE status
                    END,
           updated_at = NOW()
       WHERE id = $1`,
      [shipment_id]
    );

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await publishFbaItemChanged({ action: 'label-bind', shipmentId: Number(shipment_id || 0), source: 'fba.labels.bind' });

    return NextResponse.json({
      success: true,
      label_barcode: String(label_barcode).trim(),
      shipment_id: Number(shipment_id),
      bound_items: boundItems,
      bound_count: boundItems.length,
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
