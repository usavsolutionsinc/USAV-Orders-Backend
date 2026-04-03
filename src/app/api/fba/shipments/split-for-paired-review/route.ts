import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { detectCarrier } from '@/lib/tracking-format';
import {
  normalizeAllocations,
  refreshShipmentAggregateCounts,
  replaceTrackingAllocations,
} from '@/lib/fba/replace-tracking-allocations';

type LinePayload = { shipment_item_id: number; quantity?: number };

/**
 * POST /api/fba/shipments/split-for-paired-review
 *
 * When combine review changes the FBA Shipment ID vs the active-shipment card’s prefilled ID,
 * create a **new** plan with the new Amazon ID, move only the selected lines off the source plan,
 * clear their tracking allocations on the source, then attach UPS on the new plan.
 *
 * Body: {
 *   source_shipment_id: number,
 *   new_amazon_shipment_id: string,
 *   tracking_number: string,
 *   carrier?: string,
 *   label?: string,
 *   staff_id?: number,
 *   station?: string,
 *   lines: [{ shipment_item_id, quantity? }]
 * }
 */
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const sourceShipmentId = Number(body?.source_shipment_id);
    const newAmazonRaw = String(body?.new_amazon_shipment_id || '').trim().toUpperCase();
    const raw = String(body?.tracking_number || '').trim().toUpperCase();
    const carrier = String(body?.carrier || detectCarrier(raw)).toUpperCase();
    const label = body?.label != null ? String(body.label || '').trim() || null : 'UPS';
    const staffId = Number.isFinite(Number(body?.staff_id)) ? Number(body.staff_id) : null;
    const station = body?.station ? String(body.station).trim() : null;
    const linesRaw = Array.isArray(body?.lines) ? body.lines : [];

    if (!Number.isFinite(sourceShipmentId) || sourceShipmentId <= 0) {
      return NextResponse.json({ success: false, error: 'source_shipment_id is required' }, { status: 400 });
    }
    if (!newAmazonRaw) {
      return NextResponse.json({ success: false, error: 'new_amazon_shipment_id is required' }, { status: 400 });
    }
    if (!raw) {
      return NextResponse.json({ success: false, error: 'tracking_number is required' }, { status: 400 });
    }

    const lines: LinePayload[] = [];
    const seen = new Set<number>();
    for (const row of linesRaw) {
      const r = row as { shipment_item_id?: unknown; quantity?: unknown; qty?: unknown };
      const sid = Number(r.shipment_item_id);
      if (!Number.isFinite(sid) || sid <= 0 || seen.has(sid)) continue;
      seen.add(sid);
      const q = Math.floor(Number(r.quantity ?? r.qty ?? 1));
      lines.push({ shipment_item_id: sid, quantity: Number.isFinite(q) && q > 0 ? q : 1 });
    }
    if (lines.length === 0) {
      return NextResponse.json({ success: false, error: 'lines must include at least one shipment_item_id' }, { status: 400 });
    }

    const allocations = normalizeAllocations(
      lines.map((l) => ({ shipment_item_id: l.shipment_item_id, quantity: l.quantity ?? 1 })),
    );

    await client.query('BEGIN');

    const srcRes = await client.query(
      `SELECT id, status FROM fba_shipments WHERE id = $1 FOR UPDATE`,
      [sourceShipmentId],
    );
    if (!srcRes.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Source shipment not found' }, { status: 404 });
    }
    if (String(srcRes.rows[0].status) === 'SHIPPED') {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Cannot split a shipped shipment' }, { status: 409 });
    }

    const itemIds = lines.map((l) => l.shipment_item_id);
    const itemCheck = await client.query(
      `SELECT id FROM fba_shipment_items WHERE shipment_id = $1 AND id = ANY($2::int[])`,
      [sourceShipmentId, itemIds],
    );
    if (itemCheck.rows.length !== itemIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'One or more lines are not on the source shipment' },
        { status: 400 },
      );
    }

    for (const l of lines) {
      const qty = Math.max(1, l.quantity ?? 1);
      await client.query(
        `UPDATE fba_shipment_items SET expected_qty = $1, updated_at = NOW() WHERE id = $2 AND shipment_id = $3`,
        [qty, l.shipment_item_id, sourceShipmentId],
      );
    }

    await client.query(`DELETE FROM fba_tracking_item_allocations WHERE shipment_item_id = ANY($1::int[])`, [
      itemIds,
    ]);

    await client.query(
      `UPDATE fba_shipment_items fsi
       SET status = 'PLANNED',
           labeled_at = NULL,
           labeled_by_staff_id = NULL,
           updated_at = NOW()
       WHERE fsi.shipment_id = $1
         AND fsi.id = ANY($2::int[])
         AND fsi.status = 'LABEL_ASSIGNED'
         AND NOT EXISTS (
           SELECT 1 FROM fba_tracking_item_allocations ftia WHERE ftia.shipment_item_id = fsi.id
         )`,
      [sourceShipmentId, itemIds],
    );

    const newRef = `split-${sourceShipmentId}-${Date.now()}`;

    const insertRes = await client.query(
      `INSERT INTO fba_shipments (
         shipment_ref, destination_fc, due_date, notes,
         amazon_shipment_id,
         assigned_tech_id, assigned_packer_id, created_by_staff_id,
         status
       )
       SELECT
         $1,
         destination_fc,
         due_date,
         notes,
         $2,
         assigned_tech_id,
         assigned_packer_id,
         created_by_staff_id,
         'PLANNED'::fba_shipment_status_enum
       FROM fba_shipments WHERE id = $3
       RETURNING id`,
      [newRef, newAmazonRaw, sourceShipmentId],
    );
    const newShipmentId = Number(insertRes.rows[0]?.id);
    if (!Number.isFinite(newShipmentId)) {
      throw new Error('Failed to create split shipment');
    }

    await client.query(
      `UPDATE fba_shipment_items SET shipment_id = $1, updated_at = NOW() WHERE id = ANY($2::int[]) AND shipment_id = $3`,
      [newShipmentId, itemIds, sourceShipmentId],
    );

    await refreshShipmentAggregateCounts(client, sourceShipmentId);
    await refreshShipmentAggregateCounts(client, newShipmentId);

    const trackRes = await client.query(
      `INSERT INTO shipping_tracking_numbers
         (tracking_number_raw, tracking_number_normalized, carrier, source_system)
       VALUES ($1, $2, $3, 'fba')
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET source_system = COALESCE(shipping_tracking_numbers.source_system, EXCLUDED.source_system),
             updated_at    = NOW()
       RETURNING id, tracking_number_raw, carrier`,
      [raw, raw, carrier],
    );
    const trackingId = Number(trackRes.rows[0].id);

    const linkRes = await client.query(
      `INSERT INTO fba_shipment_tracking (shipment_id, tracking_id, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (shipment_id, tracking_id) DO UPDATE
         SET label = COALESCE(EXCLUDED.label, fba_shipment_tracking.label),
             created_at = fba_shipment_tracking.created_at
       RETURNING id, label, created_at`,
      [newShipmentId, trackingId, label],
    );

    await replaceTrackingAllocations(client, {
      shipmentId: newShipmentId,
      trackingId,
      allocations,
      staffId,
      station,
    });

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-shipments', 'fba-board', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'updated', shipmentId: sourceShipmentId, source: 'fba.split-for-paired' });
    await publishFbaShipmentChanged({ action: 'created', shipmentId: newShipmentId, source: 'fba.split-for-paired' });

    return NextResponse.json({
      success: true,
      source_shipment_id: sourceShipmentId,
      new_shipment_id: newShipmentId,
      shipment_ref: newRef,
      amazon_shipment_id: newAmazonRaw,
      link_id: Number(linkRes.rows[0].id),
      tracking_number: raw,
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /api/fba/shipments/split-for-paired-review]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to split shipment' },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
