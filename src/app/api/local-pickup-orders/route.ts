import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || '';
    const pickupDate = searchParams.get('pickupDate') || '';
    const search = (searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200);

    const filterClauses: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status.toUpperCase());
      filterClauses.push(`o.status = $${params.length}`);
    }

    if (pickupDate) {
      params.push(pickupDate);
      filterClauses.push(`o.pickup_date = $${params.length}::date`);
    }

    if (search) {
      params.push(`%${search}%`);
      filterClauses.push(
        `(o.customer_name ILIKE $${params.length} OR EXISTS (
          SELECT 1 FROM local_pickup_order_items oi
          WHERE oi.order_id = o.id
            AND (oi.product_title ILIKE $${params.length} OR oi.sku ILIKE $${params.length})
        ))`,
      );
    }

    params.push(limit);
    const limitIdx = params.length;

    const where = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';

    const ordersResult = await pool.query(
      `SELECT
         o.id,
         o.pickup_date::text,
         o.customer_name,
         o.status,
         o.notes,
         o.created_by,
         s.name AS created_by_name,
         o.completed_at,
         o.voided_by,
         o.voided_at,
         o.created_at,
         o.updated_at,
         COALESCE(agg.item_count, 0)::int AS item_count,
         COALESCE(agg.total_value, 0)::numeric(12,2)::text AS total_value
       FROM local_pickup_orders o
       LEFT JOIN staff s ON s.id = o.created_by
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS item_count,
           SUM(COALESCE(total_price, 0))::numeric(12,2) AS total_value
         FROM local_pickup_order_items
         WHERE order_id = o.id
       ) agg ON TRUE
       ${where}
       ORDER BY o.pickup_date DESC, o.created_at DESC
       LIMIT $${limitIdx}`,
      params,
    );

    const dates = await pool.query(
      `SELECT
         pickup_date::text,
         COUNT(*)::int AS order_count,
         COALESCE(SUM(agg.total_value), 0)::numeric(12,2)::text AS total_value
       FROM local_pickup_orders o
       LEFT JOIN LATERAL (
         SELECT SUM(COALESCE(total_price, 0))::numeric(12,2) AS total_value
         FROM local_pickup_order_items WHERE order_id = o.id
       ) agg ON TRUE
       WHERE o.status != 'VOIDED'
       GROUP BY pickup_date
       ORDER BY pickup_date DESC
       LIMIT 60`,
    );

    return NextResponse.json({
      success: true,
      orders: ordersResult.rows,
      dates: dates.rows,
    });
  } catch (error: any) {
    console.error('[local-pickup-orders][GET]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch orders' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const pickupDate = String(body.pickupDate || body.pickup_date || '').trim() || new Date().toISOString().slice(0, 10);
    const customerName = String(body.customerName || body.customer_name || '').trim() || null;
    const notes = String(body.notes || '').trim() || null;
    const createdBy = Number(body.createdBy || body.created_by) || null;
    const items = Array.isArray(body.items) ? body.items : [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `INSERT INTO local_pickup_orders (pickup_date, customer_name, notes, created_by, status)
         VALUES ($1::date, $2, $3, $4, 'DRAFT')
         RETURNING *`,
        [pickupDate, customerName, notes, createdBy],
      );
      const order = orderResult.rows[0];

      const insertedItems = [];
      for (const item of items) {
        const i = item as Record<string, unknown>;
        const result = await client.query(
          `INSERT INTO local_pickup_order_items
             (order_id, sku, product_title, image_url, quantity, condition_grade, parts_status, missing_parts_note, condition_note, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric)
           RETURNING *`,
          [
            order.id,
            String(i.sku || ''),
            String(i.product_title || i.productTitle || '') || null,
            String(i.image_url || i.imageUrl || '') || null,
            Math.max(1, Math.floor(Number(i.quantity) || 1)),
            String(i.condition_grade || i.conditionGrade || 'USED_A'),
            String(i.parts_status || i.partsStatus || 'COMPLETE'),
            String(i.missing_parts_note || i.missingPartsNote || '') || null,
            String(i.condition_note || i.conditionNote || '') || null,
            Number(i.total_price || i.totalPrice || i.total) || 0,
          ],
        );
        insertedItems.push(result.rows[0]);
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        order: { ...order, items: insertedItems },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[local-pickup-orders][POST]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to create order' },
      { status: 500 },
    );
  }
}
