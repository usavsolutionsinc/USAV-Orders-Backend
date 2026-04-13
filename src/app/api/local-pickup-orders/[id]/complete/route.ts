import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const result = await pool.query(
      `UPDATE local_pickup_orders
       SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'DRAFT'
       RETURNING *`,
      [orderId],
    );

    if (result.rows.length === 0) {
      const check = await pool.query(
        `SELECT status FROM local_pickup_orders WHERE id = $1`,
        [orderId],
      );
      if (check.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
      }
      return NextResponse.json(
        { success: false, error: `Order is already ${check.rows[0].status}` },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, order: result.rows[0] });
  } catch (error: any) {
    console.error('[local-pickup-orders][complete]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to complete order' },
      { status: 500 },
    );
  }
}
