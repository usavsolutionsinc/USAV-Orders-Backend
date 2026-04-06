import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

// ── POST /api/fba/shipments/close ─────────────────────────────────────────────
// Ship Close: transitions all LABEL_ASSIGNED items (and any remaining
// READY_TO_GO items) to SHIPPED and marks the shipment as SHIPPED.
// Requires all items to be at least READY_TO_GO (admin can force-close).
// Writes a SHIP/SHIPPED event to fba_fnsku_logs for each shipped item.
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

    // Write one immutable SHIPPED event per item.
    for (const item of itemsRes.rows) {
      await client.query(
        `INSERT INTO fba_fnsku_logs
           (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
         VALUES ($1, 'SHIP', 'SHIPPED', $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          item.fnsku,
          staff_id,
          shipment_id,
          item.id,
          Math.max(1, Number(item.actual_qty) || 0),
          station || 'SHIP_CLOSE',
          `Shipment closed (${force ? 'force' : 'standard'})`,
          JSON.stringify({
            trigger: 'fba.shipments.close',
            shipment_ref: shipmentCheck.rows[0].shipment_ref || null,
          }),
        ]
      );
    }

    // Close shipment — set status to SHIPPED.
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

    await invalidateCacheTags(['fba-board', 'fba-shipments', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'closed', shipmentId: Number(shipment_id || 0), source: 'fba.shipments.close' });

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
