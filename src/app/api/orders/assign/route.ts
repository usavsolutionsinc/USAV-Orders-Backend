import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';

/**
 * Upsert a single work_assignment row for a given order + work_type.
 * Uses the appropriate assignee column (assigned_tech_id or assigned_packer_id).
 */
async function upsertOrderAssignment(
  orderId: number,
  workType: 'TEST' | 'PACK',
  staffId: number | null,
  client: typeof pool = pool
) {
  const col = workType === 'PACK' ? 'assigned_packer_id' : 'assigned_tech_id';

  if (staffId === null) {
    // Cancel any active assignment for this order/work_type
    await client.query(
      `UPDATE work_assignments
       SET status = 'CANCELED', updated_at = NOW()
       WHERE entity_type = 'ORDER'
         AND entity_id   = $1
         AND work_type   = $2
         AND status IN ('ASSIGNED', 'IN_PROGRESS')`,
      [orderId, workType]
    );
    return;
  }

  const existing = await client.query(
    `SELECT id
     FROM work_assignments
     WHERE entity_type = 'ORDER'
       AND entity_id   = $1
       AND work_type   = $2
       AND status IN ('ASSIGNED', 'IN_PROGRESS')
     ORDER BY id DESC
     LIMIT 1`,
    [orderId, workType]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE work_assignments
       SET ${col} = $1, updated_at = NOW()
       WHERE id = $2`,
      [staffId, existing.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO work_assignments (entity_type, entity_id, work_type, ${col}, status, priority)
       VALUES ('ORDER', $1, $2, $3, 'ASSIGNED', 100)
       ON CONFLICT DO NOTHING`,
      [orderId, workType, staffId]
    );
  }
}

/**
 * POST /api/orders/assign
 * Assigns tech and/or packer to one or more orders via work_assignments.
 * Also handles non-assignment order field updates (ship_by_date, notes, etc.).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      orderId,
      orderIds,
      testerId,
      packerId,
      shipByDate,
      outOfStock,
      notes,
      shippingTrackingNumber,
      itemNumber,
      condition,
    } = body;

    if (!orderId && (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0)) {
      return NextResponse.json(
        { error: 'orderId or orderIds array is required' },
        { status: 400 }
      );
    }

    const idsToUpdate: number[] = (orderId ? [orderId] : orderIds).map(Number);

    // ── 1. Write work_assignments for tech / packer ──────────────────────────
    if (testerId !== undefined) {
      const techId = testerId === 0 ? null : (testerId ? Number(testerId) : null);
      await Promise.all(idsToUpdate.map((id) => upsertOrderAssignment(id, 'TEST', techId)));
    }

    if (packerId !== undefined) {
      const pkId = packerId === 0 ? null : (packerId ? Number(packerId) : null);
      await Promise.all(idsToUpdate.map((id) => upsertOrderAssignment(id, 'PACK', pkId)));
    }

    // ── 2. Update remaining fields directly on orders table ─────────────────
    const updates: string[] = [];
    const values: any[]     = [];
    let paramCount = 1;

    if (shipByDate !== undefined) {
      updates.push(`ship_by_date = $${paramCount++}`);
      values.push(shipByDate);
    }
    if (outOfStock !== undefined) {
      updates.push(`out_of_stock = $${paramCount++}`);
      values.push(outOfStock);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(notes);
    }
    if (shippingTrackingNumber !== undefined) {
      updates.push(`shipping_tracking_number = $${paramCount++}`);
      values.push(shippingTrackingNumber || null);
    }
    if (itemNumber !== undefined) {
      updates.push(`item_number = $${paramCount++}`);
      values.push(itemNumber || null);
    }
    if (condition !== undefined) {
      updates.push(`condition = $${paramCount++}`);
      values.push(condition || null);
    }

    if (updates.length > 0) {
      const idPlaceholders = idsToUpdate.map(() => `$${paramCount++}`).join(', ');
      values.push(...idsToUpdate);
      await pool.query(
        `UPDATE orders SET ${updates.join(', ')} WHERE id IN (${idPlaceholders})`,
        values
      );
    }

    await invalidateCacheTags(['orders', 'shipped']);
    await publishOrderChanged({ orderIds: idsToUpdate, source: 'orders.assign' });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error assigning order:', error);
    return NextResponse.json(
      { error: 'Failed to assign order', details: error.message },
      { status: 500 }
    );
  }
}
