import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const voidedBy = Number(body.voidedBy || body.voided_by) || null;

    const result = await pool.query(
      `UPDATE local_pickup_orders
       SET status = 'VOIDED', voided_by = $2, voided_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status != 'VOIDED'
       RETURNING *`,
      [orderId, voidedBy],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Order not found or already voided' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, order: result.rows[0] });
  } catch (error: any) {
    console.error('[local-pickup-orders][void]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to void order' },
      { status: 500 },
    );
  }
}
