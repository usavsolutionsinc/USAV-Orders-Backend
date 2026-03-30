import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createStationActivityLog } from '@/lib/station-activity';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

// ── POST /api/fba/items/ready ─────────────────────────────────────────────────
// Tech marks an FNSKU item as READY_TO_GO after testing/validation.
// Increments actual_qty and transitions status PLANNED → READY_TO_GO.
// Writes to fba_fnsku_logs in the same transaction.
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
    const normalizedFnsku = String(fnsku).trim().toUpperCase();

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
      [shipment_id, normalizedFnsku, staff_id]
    );

    const item = itemRes.rows[0];

    const logRes = await client.query(
      `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
       VALUES ($1, 'PACK', 'READY', $2, $3, $4, 1, $5, $6, $7::jsonb)
       RETURNING id, created_at`,
      [
        normalizedFnsku,
        staff_id,
        shipment_id,
        item.id,
        station || 'TECH_READY',
        'Ready marked via /api/fba/items/ready',
        JSON.stringify({
          trigger: 'fba.items.ready',
          previous_status: item.status,
        }),
      ]
    );

    await createStationActivityLog(client, {
      station: 'PACK',
      activityType: 'FBA_READY',
      staffId: Number(staff_id),
      scanRef: normalizedFnsku,
      fnsku: normalizedFnsku,
      fbaShipmentId: Number(shipment_id),
      fbaShipmentItemId: Number(item.id),
      notes: 'Ready marked via API',
      metadata: {
        fnsku_log_id: Number(logRes.rows[0].id),
        quantity: 1,
      },
    });

    // Roll up shipment counters and advance status when nothing remains planned.
    await client.query(
      `UPDATE fba_shipments
       SET ready_item_count   = counts.ready_item_count,
           packed_item_count  = counts.packed_item_count,
           shipped_item_count = counts.shipped_item_count,
           status             = CASE
                                  WHEN fba_shipments.status = 'PLANNED' AND counts.planned_item_count = 0
                                    THEN 'READY_TO_GO'::fba_shipment_status_enum
                                  ELSE fba_shipments.status
                                END,
           updated_at         = NOW()
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
       WHERE id = $1
         AND fba_shipments.id = counts.shipment_id`,
      [shipment_id]
    );

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await publishFbaItemChanged({ action: 'ready', shipmentId: Number(shipment_id || 0), itemId: Number(item?.id || 0), fnsku: normalizedFnsku || '', source: 'fba.items.ready' });

    return NextResponse.json({
      success: true,
      item,
      event: {
        id: Number(logRes.rows[0].id),
        created_at: logRes.rows[0].created_at,
        type: 'FBA_LOG',
      },
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
