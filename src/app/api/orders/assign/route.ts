import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/assign - Assign order to packer
 * Note: tester_id removed 2026-02-05 - test assignment now implicit when tech scans order
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

    // Note: testerId assignment removed - techs are now assigned implicitly when they scan
    if (testerId !== undefined) {
      console.warn('testerId assignment ignored - tester_id column removed from orders table');
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
