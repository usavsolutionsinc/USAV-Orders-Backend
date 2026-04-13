import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const orderResult = await pool.query(
      `SELECT o.*, s.name AS created_by_name, vs.name AS voided_by_name
       FROM local_pickup_orders o
       LEFT JOIN staff s ON s.id = o.created_by
       LEFT JOIN staff vs ON vs.id = o.voided_by
       WHERE o.id = $1`,
      [orderId],
    );
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const itemsResult = await pool.query(
      `SELECT oi.*,
         COALESCE(sp.display_name, oi.product_title) AS display_name,
         COALESCE(sp.image_url, oi.image_url) AS resolved_image_url
       FROM local_pickup_order_items oi
       LEFT JOIN sku_platform_ids sp
         ON sp.platform_sku = oi.sku AND sp.platform = 'ecwid' AND sp.is_active = true
       WHERE oi.order_id = $1
       ORDER BY oi.id ASC`,
      [orderId],
    );

    return NextResponse.json({
      success: true,
      order: {
        ...orderResult.rows[0],
        pickup_date: String(orderResult.rows[0].pickup_date),
        items: itemsResult.rows,
      },
    });
  } catch (error: any) {
    console.error('[local-pickup-orders][GET/:id]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch order' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];

    if ('customer_name' in body || 'customerName' in body) {
      values.push(String(body.customer_name ?? body.customerName ?? '').trim() || null);
      setClauses.push(`customer_name = $${values.length}`);
    }
    if ('pickup_date' in body || 'pickupDate' in body) {
      values.push(String(body.pickup_date ?? body.pickupDate ?? ''));
      setClauses.push(`pickup_date = $${values.length}::date`);
    }
    if ('notes' in body) {
      values.push(String(body.notes ?? '').trim() || null);
      setClauses.push(`notes = $${values.length}`);
    }

    values.push(orderId);
    const idIdx = values.length;

    const result = await pool.query(
      `UPDATE local_pickup_orders SET ${setClauses.join(', ')} WHERE id = $${idIdx} AND status = 'DRAFT' RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Order not found or not in DRAFT status' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, order: result.rows[0] });
  } catch (error: any) {
    console.error('[local-pickup-orders][PATCH/:id]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update order' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const result = await pool.query(
      `DELETE FROM local_pickup_orders WHERE id = $1 AND status = 'DRAFT' RETURNING id`,
      [orderId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Order not found or not in DRAFT status' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, deleted: true });
  } catch (error: any) {
    console.error('[local-pickup-orders][DELETE/:id]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete order' },
      { status: 500 },
    );
  }
}
