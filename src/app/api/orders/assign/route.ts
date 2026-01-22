import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/assign - Assign order to technician
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, assignedTo, urgent, shipByDate } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (assignedTo !== undefined) {
      updates.push(`assigned_to = $${paramCount++}`);
      values.push(assignedTo);
      
      // If assigning to a tech, change status to 'assigned'
      if (assignedTo) {
        updates.push(`status = $${paramCount++}`);
        values.push('assigned');
      }
    }

    if (urgent !== undefined) {
      updates.push(`urgent = $${paramCount++}`);
      values.push(urgent);
    }

    if (shipByDate !== undefined) {
      updates.push(`ship_by_date = $${paramCount++}`);
      values.push(shipByDate);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(orderId);

    await pool.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $${paramCount}`,
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
