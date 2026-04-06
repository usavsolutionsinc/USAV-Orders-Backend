import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { parseFbaPlanId } from '@/lib/fba/plan-id';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

type Params = Promise<{ id: string; itemId: string }>;

/**
 * PATCH /api/fba/shipments/[id]/items/[itemId]/reassign
 *
 * Moves an item from its current shipment to a different shipment.
 * Body: { target_shipment_id: number }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params },
) {
  const client = await pool.connect();
  try {
    const { id, itemId } = await params;
    const sourceShipmentId = parseFbaPlanId(id);
    const itemIdNum = Number(itemId);

    if (sourceShipmentId == null || !Number.isFinite(itemIdNum)) {
      return NextResponse.json({ success: false, error: 'Invalid shipment or item ID' }, { status: 400 });
    }

    const body = await request.json();
    const targetShipmentId = Number(body.target_shipment_id);
    if (!Number.isFinite(targetShipmentId) || targetShipmentId <= 0) {
      return NextResponse.json({ success: false, error: 'target_shipment_id is required' }, { status: 400 });
    }
    if (targetShipmentId === sourceShipmentId) {
      return NextResponse.json({ success: false, error: 'Item is already in this shipment' }, { status: 400 });
    }

    await client.query('BEGIN');

    // Verify item exists in source
    const item = await client.query(
      `SELECT id, fnsku, status FROM fba_shipment_items WHERE id = $1 AND shipment_id = $2`,
      [itemIdNum, sourceShipmentId],
    );
    if (!item.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Item not found in source shipment' }, { status: 404 });
    }

    // Verify target shipment exists and is not shipped
    const target = await client.query(
      `SELECT id, status FROM fba_shipments WHERE id = $1`,
      [targetShipmentId],
    );
    if (!target.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Target shipment not found' }, { status: 404 });
    }
    if (target.rows[0].status === 'SHIPPED') {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Cannot move items to a shipped shipment' }, { status: 409 });
    }

    // Move the item
    await client.query(
      `UPDATE fba_shipment_items SET shipment_id = $1, updated_at = NOW() WHERE id = $2`,
      [targetShipmentId, itemIdNum],
    );

    // Touch updated_at on both shipments so real-time listeners pick up the change
    await client.query(`UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1`, [sourceShipmentId]);
    await client.query(`UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1`, [targetShipmentId]);

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await publishFbaItemChanged({ action: 'reassign', shipmentId: Number(targetShipmentId || 0), itemId: Number(itemId), source: 'fba.shipments.items.reassign' });

    return NextResponse.json({ success: true, moved: { item_id: itemIdNum, from: sourceShipmentId, to: targetShipmentId } });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/fba/shipments/[id]/items/[itemId]/reassign]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to reassign item' },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
