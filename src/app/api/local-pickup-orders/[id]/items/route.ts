import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const orderCheck = await pool.query(
      `SELECT status FROM local_pickup_orders WHERE id = $1`,
      [orderId],
    );
    if (orderCheck.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (orderCheck.rows[0].status !== 'DRAFT') {
      return NextResponse.json(
        { success: false, error: 'Can only add items to DRAFT orders' },
        { status: 400 },
      );
    }

    const body = (await req.json()) as Record<string, unknown>;

    const result = await pool.query(
      `INSERT INTO local_pickup_order_items
         (order_id, sku, product_title, image_url, quantity, condition_grade, parts_status, missing_parts_note, condition_note, total_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric)
       RETURNING *`,
      [
        orderId,
        String(body.sku || ''),
        String(body.product_title || body.productTitle || '') || null,
        String(body.image_url || body.imageUrl || '') || null,
        Math.max(1, Math.floor(Number(body.quantity) || 1)),
        String(body.condition_grade || body.conditionGrade || 'USED_A'),
        String(body.parts_status || body.partsStatus || 'COMPLETE'),
        String(body.missing_parts_note || body.missingPartsNote || '') || null,
        String(body.condition_note || body.conditionNote || '') || null,
        Math.max(0, Number(body.total_price || body.totalPrice || body.total) || 0),
      ],
    );

    await pool.query(
      `UPDATE local_pickup_orders SET updated_at = NOW() WHERE id = $1`,
      [orderId],
    );

    return NextResponse.json({ success: true, item: result.rows[0] });
  } catch (error: any) {
    console.error('[local-pickup-orders][POST items]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to add item' },
      { status: 500 },
    );
  }
}
