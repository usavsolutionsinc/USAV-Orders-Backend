import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

type Params = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id, itemId } = await params;
    const orderId = Number(id);
    const itemIdNum = Number(itemId);
    if (!Number.isFinite(orderId) || !Number.isFinite(itemIdNum)) {
      return NextResponse.json({ success: false, error: 'Invalid IDs' }, { status: 400 });
    }

    const orderCheck = await pool.query(
      `SELECT status FROM local_pickup_orders WHERE id = $1`,
      [orderId],
    );
    if (orderCheck.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (orderCheck.rows[0].status === 'VOIDED') {
      return NextResponse.json(
        { success: false, error: 'Cannot edit voided orders' },
        { status: 400 },
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];

    const fieldMap: Record<string, string> = {
      sku: 'sku',
      product_title: 'product_title',
      productTitle: 'product_title',
      image_url: 'image_url',
      imageUrl: 'image_url',
      quantity: 'quantity',
      condition_grade: 'condition_grade',
      conditionGrade: 'condition_grade',
      parts_status: 'parts_status',
      partsStatus: 'parts_status',
      missing_parts_note: 'missing_parts_note',
      missingPartsNote: 'missing_parts_note',
      condition_note: 'condition_note',
      conditionNote: 'condition_note',
      total_price: 'total_price',
      totalPrice: 'total_price',
      total: 'total_price',
    };

    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (!(bodyKey in body)) continue;
      const raw = body[bodyKey];
      if (dbCol === 'quantity') {
        values.push(Math.max(1, Math.floor(Number(raw) || 1)));
      } else if (dbCol === 'total_price') {
        values.push(Math.max(0, Number(raw) || 0));
        setClauses.push(`${dbCol} = $${values.length}::numeric`);
        continue;
      } else {
        values.push(String(raw ?? '').trim() || null);
      }
      setClauses.push(`${dbCol} = $${values.length}`);
    }

    values.push(itemIdNum);
    const itemIdx = values.length;
    values.push(orderId);
    const orderIdx = values.length;

    const result = await pool.query(
      `UPDATE local_pickup_order_items SET ${setClauses.join(', ')} WHERE id = $${itemIdx} AND order_id = $${orderIdx} RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    await pool.query(
      `UPDATE local_pickup_orders SET updated_at = NOW() WHERE id = $1`,
      [orderId],
    );

    return NextResponse.json({ success: true, item: result.rows[0] });
  } catch (error: any) {
    console.error('[local-pickup-orders][PATCH item]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update item' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id, itemId } = await params;
    const orderId = Number(id);
    const itemIdNum = Number(itemId);
    if (!Number.isFinite(orderId) || !Number.isFinite(itemIdNum)) {
      return NextResponse.json({ success: false, error: 'Invalid IDs' }, { status: 400 });
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
        { success: false, error: 'Can only delete items from DRAFT orders' },
        { status: 400 },
      );
    }

    const result = await pool.query(
      `DELETE FROM local_pickup_order_items WHERE id = $1 AND order_id = $2 RETURNING id`,
      [itemIdNum, orderId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    await pool.query(
      `UPDATE local_pickup_orders SET updated_at = NOW() WHERE id = $1`,
      [orderId],
    );

    return NextResponse.json({ success: true, deleted: true });
  } catch (error: any) {
    console.error('[local-pickup-orders][DELETE item]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete item' },
      { status: 500 },
    );
  }
}
