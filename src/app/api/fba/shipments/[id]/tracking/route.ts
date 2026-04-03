import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getInvalidFbaPlanIdMessage, parseFbaPlanId } from '@/lib/fba/plan-id';
import { detectCarrier } from '@/lib/tracking-format';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { normalizeAllocations, replaceTrackingAllocations } from '@/lib/fba/replace-tracking-allocations';

type Params = Promise<{ id: string }>;

// ── GET /api/fba/shipments/[id]/tracking ─────────────────────────────────────
// Returns all tracking numbers linked to this shipment via fba_shipment_tracking.
export async function GET(
  _req: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         fst.id          AS link_id,
         fst.label,
         fst.created_at  AS linked_at,
         stn.id          AS tracking_id,
         stn.tracking_number_raw,
         stn.tracking_number_normalized,
         stn.carrier,
         stn.latest_status_category,
         stn.latest_status_description,
         stn.is_label_created,
         stn.is_carrier_accepted,
         stn.is_in_transit,
         stn.is_out_for_delivery,
         stn.is_delivered,
         stn.has_exception,
         stn.is_terminal,
         stn.delivered_at,
         stn.latest_event_at,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'shipment_item_id', fta.shipment_item_id,
                 'qty', fta.qty,
                 'fnsku', fsi.fnsku,
                 'display_title', COALESCE(NULLIF(TRIM(fsi.product_title), ''), fsi.fnsku)
               )
               ORDER BY fta.shipment_item_id
             )
             FROM fba_tracking_item_allocations fta
             JOIN fba_shipment_items fsi ON fsi.id = fta.shipment_item_id
             WHERE fta.shipment_id = fst.shipment_id
               AND fta.tracking_id = fst.tracking_id
           ),
           '[]'::jsonb
         ) AS allocations
       FROM fba_shipment_tracking fst
       JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
       WHERE fst.shipment_id = $1
       ORDER BY fst.created_at DESC`,
      [planId]
    );

    return NextResponse.json({ success: true, tracking: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]/tracking]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch tracking' },
      { status: 500 }
    );
  }
}

// ── POST /api/fba/shipments/[id]/tracking ────────────────────────────────────
// Links a tracking number to this shipment.
// 1. Upserts the raw tracking number into shipping_tracking_numbers.
// 2. Creates the link in fba_shipment_tracking.
// 3. Optional: replaces per-item bundle allocations for this shipment+tracking.
// Body: {
//   tracking_number: string,
//   carrier?: string,
//   label?: string,
//   staff_id?: number,
//   station?: string,
//   allocations?: [{ shipment_item_id|item_id, quantity|qty }]
// }
export async function POST(
  request: NextRequest,
  { params }: { params: Params }
) {
  const client = await pool.connect();
  try {
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const body = await request.json();
    const raw = String(body.tracking_number || '').trim().toUpperCase();
    if (!raw) {
      return NextResponse.json({ success: false, error: 'tracking_number is required' }, { status: 400 });
    }

    const carrier = String(body.carrier || detectCarrier(raw)).toUpperCase();
    const label = body.label ? String(body.label).trim() : null;
    const staffId = Number.isFinite(Number(body?.staff_id)) ? Number(body.staff_id) : null;
    const station = body?.station ? String(body.station).trim() : null;
    const hasAllocationsPayload = Object.prototype.hasOwnProperty.call(body ?? {}, 'allocations');
    const allocations = hasAllocationsPayload ? normalizeAllocations(body.allocations) : [];

    await client.query('BEGIN');

    // Upsert into shipping_tracking_numbers
    const trackRes = await client.query(
      `INSERT INTO shipping_tracking_numbers
         (tracking_number_raw, tracking_number_normalized, carrier, source_system)
       VALUES ($1, $2, $3, 'fba')
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET source_system = COALESCE(shipping_tracking_numbers.source_system, EXCLUDED.source_system),
             updated_at    = NOW()
       RETURNING id, tracking_number_raw, carrier`,
      [raw, raw, carrier]
    );
    const trackingId = trackRes.rows[0].id;

    // Link to the shipment
    const linkRes = await client.query(
      `INSERT INTO fba_shipment_tracking (shipment_id, tracking_id, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (shipment_id, tracking_id) DO UPDATE
         SET label = COALESCE(EXCLUDED.label, fba_shipment_tracking.label),
             created_at = fba_shipment_tracking.created_at
       RETURNING id, label, created_at`,
      [planId, trackingId, label]
    );

    let allocationCount = 0;
    if (hasAllocationsPayload) {
      allocationCount = await replaceTrackingAllocations(client, {
        shipmentId: planId,
        trackingId: Number(trackingId),
        allocations,
        staffId,
        station,
      });
    }

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-shipments', 'fba-board', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'tracking-linked', shipmentId: Number(id), source: 'fba.shipments.tracking.link' });

    return NextResponse.json(
      {
        success: true,
        link_id: linkRes.rows[0].id,
        tracking_id: trackingId,
        tracking_number: raw,
        carrier,
        label: linkRes.rows[0].label,
        allocation_count: allocationCount,
      },
      { status: 201 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments/[id]/tracking]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to link tracking number' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// ── PATCH /api/fba/shipments/[id]/tracking ───────────────────────────────────
// Updates a linked tracking row by link id.
// Body: {
//   link_id: number,
//   tracking_number: string,
//   carrier?: string,
//   label?: string,
//   staff_id?: number,
//   station?: string,
//   allocations?: [{ shipment_item_id|item_id, quantity|qty }]
// }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params }
) {
  const client = await pool.connect();
  try {
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const body = await request.json();
    const linkId = Number(body?.link_id);
    const raw = String(body?.tracking_number || '').trim().toUpperCase();
    const label = body?.label != null ? String(body.label || '').trim() || null : undefined;
    const staffId = Number.isFinite(Number(body?.staff_id)) ? Number(body.staff_id) : null;
    const station = body?.station ? String(body.station).trim() : null;
    const hasAllocationsPayload = Object.prototype.hasOwnProperty.call(body ?? {}, 'allocations');
    const allocations = hasAllocationsPayload ? normalizeAllocations(body.allocations) : [];
    if (!Number.isFinite(linkId) || linkId <= 0) {
      return NextResponse.json({ success: false, error: 'link_id is required' }, { status: 400 });
    }
    if (!raw) {
      return NextResponse.json({ success: false, error: 'tracking_number is required' }, { status: 400 });
    }

    const carrier = String(body?.carrier || detectCarrier(raw)).toUpperCase();

    await client.query('BEGIN');

    const linkCheck = await client.query(
      `SELECT id, tracking_id
       FROM fba_shipment_tracking
       WHERE id = $1 AND shipment_id = $2`,
      [linkId, planId]
    );
    if (!linkCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Tracking link not found' }, { status: 404 });
    }

    const trackRes = await client.query(
      `INSERT INTO shipping_tracking_numbers
         (tracking_number_raw, tracking_number_normalized, carrier, source_system)
       VALUES ($1, $2, $3, 'fba')
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET tracking_number_raw = EXCLUDED.tracking_number_raw,
             carrier = COALESCE(NULLIF(EXCLUDED.carrier, 'UNKNOWN'), shipping_tracking_numbers.carrier),
             updated_at = NOW()
       RETURNING id, tracking_number_raw, carrier`,
      [raw, raw, carrier]
    );

    const trackingId = Number(trackRes.rows[0].id);
    const previousTrackingId = Number(linkCheck.rows[0].tracking_id);
    const nextCarrier = String(trackRes.rows[0].carrier || carrier || 'UNKNOWN').toUpperCase();

    const updates: string[] = ['tracking_id = $1'];
    const values: unknown[] = [trackingId];
    let idx = 2;
    if (label !== undefined) {
      updates.push(`label = $${idx++}`);
      values.push(label);
    }
    values.push(linkId, planId);

    const updated = await client.query(
      `UPDATE fba_shipment_tracking
       SET ${updates.join(', ')}
       WHERE id = $${idx} AND shipment_id = $${idx + 1}
       RETURNING id, shipment_id, tracking_id, label, created_at`,
      values
    );

    if (previousTrackingId !== trackingId) {
      await client.query(
        `INSERT INTO fba_tracking_item_allocations
           (shipment_id, tracking_id, shipment_item_id, qty, created_at, updated_at)
         SELECT shipment_id, $3, shipment_item_id, qty, created_at, NOW()
         FROM fba_tracking_item_allocations
         WHERE shipment_id = $1 AND tracking_id = $2
         ON CONFLICT (shipment_id, tracking_id, shipment_item_id)
         DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
        [planId, previousTrackingId, trackingId]
      );
      await client.query(
        `DELETE FROM fba_tracking_item_allocations
         WHERE shipment_id = $1 AND tracking_id = $2`,
        [planId, previousTrackingId]
      );
    }

    let allocationCount = 0;
    if (hasAllocationsPayload) {
      allocationCount = await replaceTrackingAllocations(client, {
        shipmentId: planId,
        trackingId,
        allocations,
        staffId,
        station,
      });
    }

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-shipments', 'fba-board', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'tracking-linked', shipmentId: Number(id), source: 'fba.shipments.tracking.update' });

    return NextResponse.json({
      success: true,
      link_id: Number(updated.rows[0].id),
      shipment_id: Number(updated.rows[0].shipment_id),
      tracking_id: Number(updated.rows[0].tracking_id),
      tracking_number: raw,
      carrier: nextCarrier,
      label: updated.rows[0].label ?? null,
      allocation_count: allocationCount,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/fba/shipments/[id]/tracking]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update tracking number' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// ── DELETE /api/fba/shipments/[id]/tracking?link_id=X ────────────────────────
// Unlinks a tracking record from this shipment (does not delete the tracking record itself).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    const { searchParams } = new URL(request.url);
    const linkId = Number(searchParams.get('link_id') || '');

    if (planId == null || !Number.isFinite(linkId)) {
      const error = planId == null ? getInvalidFbaPlanIdMessage(id) : 'Invalid ids';
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    const linkRes = await pool.query(
      `DELETE FROM fba_shipment_tracking
       WHERE id = $1 AND shipment_id = $2
       RETURNING tracking_id`,
      [linkId, planId]
    );

    const trackingId = Number(linkRes.rows[0]?.tracking_id || 0);
    if (trackingId > 0) {
      await pool.query(
        `DELETE FROM fba_tracking_item_allocations
         WHERE shipment_id = $1 AND tracking_id = $2`,
        [planId, trackingId]
      );
    }

    await invalidateCacheTags(['fba-shipments', 'fba-board', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'tracking-unlinked', shipmentId: Number(id), source: 'fba.shipments.tracking.unlink' });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/fba/shipments/[id]/tracking]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to unlink tracking' },
      { status: 500 }
    );
  }
}
