import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { withAuth } from '@/lib/auth/withAuth';

// ── POST /api/fba/items/verify ────────────────────────────────────────────────
// Packer scans a TESTED item to mark it physically packed (TESTED → PACKED).
// PACKED items form the combiner's queue on the Combine sub-page. Records
// verified_by_staff_id + verified_at and writes to fba_fnsku_logs in the same
// transaction. (Combining under a label is a later step: PACKED → LABEL_ASSIGNED.)
//
// Body: { shipment_id, fnsku, station? } — actor is from the verified session.
export const POST = withAuth(async (request: NextRequest, ctx) => {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { shipment_id, fnsku, station } = body;
    const staff_id = ctx.staffId;

    if (!shipment_id || !fnsku?.trim()) {
      return NextResponse.json(
        { success: false, error: 'shipment_id and fnsku are required' },
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

    // Find the item — must be TESTED (or already PACKED/LABEL_ASSIGNED for re-scan)
    const itemRes = await client.query(
      `SELECT * FROM fba_shipment_items
       WHERE shipment_id = $1 AND fnsku = $2`,
      [shipment_id, normalizedFnsku]
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
        { success: false, error: 'Item must be TESTED before the packer can pack it' },
        { status: 409 }
      );
    }
    if (item.status === 'SHIPPED') {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Item is already shipped' }, { status: 409 });
    }

    // Advance TESTED → PACKED (idempotent — leaves already-packed/combined items as-is).
    const updatedRes = await client.query(
      `UPDATE fba_shipment_items
       SET status               = CASE WHEN status = 'TESTED'
                                       THEN 'PACKED'::fba_shipment_status_enum
                                       ELSE status END,
           verified_by_staff_id = COALESCE(verified_by_staff_id, $1),
           verified_at          = COALESCE(verified_at, NOW()),
           updated_at           = NOW()
       WHERE id = $2
       RETURNING *`,
      [staff_id, item.id]
    );

    const logRes = await client.query(
      `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
       VALUES ($1, 'PACK', 'VERIFIED', $2, $3, $4, 0, $5, $6, $7::jsonb)
       RETURNING id, created_at`,
      [
        normalizedFnsku,
        staff_id,
        shipment_id,
        item.id,
        station || 'PACK_VERIFY',
        'Packer verification',
        JSON.stringify({
          trigger: 'fba.items.verify',
          item_status: item.status,
        }),
      ]
    );

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-board']);
    await publishFbaItemChanged({ action: 'verify', shipmentId: Number(shipment_id || 0), itemId: Number(item?.id || 0), fnsku: normalizedFnsku || '', source: 'fba.items.verify', organizationId: ctx.organizationId });

    return NextResponse.json({
      success: true,
      item: updatedRes.rows[0],
      event: {
        id: Number(logRes.rows[0].id),
        created_at: logRes.rows[0].created_at,
        type: 'FBA_LOG',
      },
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
}, {
  permission: 'fba.stage_shipments',
  audit: {
    source: 'fba.items.verify',
    action: 'fba.fnsku.verify',
    entityType: 'fba_shipment_item',
    entityId: ({ body }) => {
      const b = body as { shipment_id?: number; fnsku?: string } | null;
      return b?.shipment_id ?? null;
    },
    extra: ({ body }) => {
      const b = body as { fnsku?: string } | null;
      return { fnsku: b?.fnsku ?? null };
    },
  },
});
