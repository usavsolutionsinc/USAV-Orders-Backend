import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/assign - Assign order to technician or packer
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, orderIds, testerId, packerId, shipByDate, outOfStock } = body;

    if (!orderId && (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0)) {
      return NextResponse.json(
        { error: 'orderId or orderIds array is required' },
        { status: 400 }
      );
    }

    const idsToUpdate = orderId ? [orderId] : orderIds;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (testerId !== undefined) {
      updates.push(`tester_id = $${paramCount++}`);
      values.push(testerId === 0 ? null : (testerId || null));
    }

    if (packerId !== undefined) {
      updates.push(`packer_id = $${paramCount++}`);
      values.push(packerId === 0 ? null : (packerId || null));
    }

    if (shipByDate !== undefined) {
      updates.push(`ship_by_date = $${paramCount++}`);
      values.push(shipByDate);
    }

    if (outOfStock !== undefined) {
      updates.push(`out_of_stock = $${paramCount++}`);
      values.push(outOfStock);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Add ids to values
    const idPlaceholders = idsToUpdate.map(() => `$${paramCount++}`).join(', ');
    values.push(...idsToUpdate);

    await pool.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id IN (${idPlaceholders})`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error assigning order:', error);
    return NextResponse.json(
      { error: 'Failed to assign order', details: error.message },
      { status: 500 }
    );
  }
}
