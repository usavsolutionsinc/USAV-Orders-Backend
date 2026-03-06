import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { toPSTDateKey } from '@/lib/timezone';

interface RecentOrder {
  id: number;
  order_id: string;
  product_title: string;
  item_number: string | null;
  sku: string;
  quantity: string | number | null;
  shipping_tracking_number: string | null;
  is_shipped: boolean;
  status: string | null;
  ship_by_date: string | null;
  created_at: string;
  has_manual: boolean;
}

interface DateGroup {
  date: string;
  label: string;
  orders: RecentOrder[];
}

/**
 * GET /api/orders/recent?days=7
 * Returns all orders (shipped + unshipped) from the last N days,
 * grouped by creation date descending. Used by ManualAssignmentSidebarPanel.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 1), 60);
    const query = searchParams.get('q') || '';

    let sql = `
      SELECT
        o.id,
        o.order_id,
        o.product_title,
        o.item_number,
        o.sku,
        o.quantity,
        o.shipping_tracking_number,
        COALESCE(o.is_shipped, false) AS is_shipped,
        o.status,
        to_char(o.ship_by_date, 'YYYY-MM-DD') AS ship_by_date,
        o.created_at,
        EXISTS (
          SELECT 1 FROM product_manuals pm
          WHERE pm.is_active = true
            AND (
              (o.item_number IS NOT NULL AND pm.item_number = o.item_number)
              OR (o.sku IS NOT NULL AND pm.sku = o.sku)
            )
        ) AS has_manual
      FROM orders o
      WHERE o.created_at >= NOW() - INTERVAL '${days} days'
    `;

    const params: string[] = [];
    let paramCount = 1;

    if (query.trim()) {
      sql += ` AND (
        o.order_id ILIKE $${paramCount}
        OR o.product_title ILIKE $${paramCount}
        OR o.item_number ILIKE $${paramCount}
        OR o.sku ILIKE $${paramCount}
        OR o.shipping_tracking_number ILIKE $${paramCount}
      )`;
      params.push(`%${query.trim()}%`);
      paramCount++;
    }

    sql += ' ORDER BY o.created_at DESC LIMIT 500';

    const result = await pool.query(sql, params);
    const orders: RecentOrder[] = result.rows.map((row) => ({
      id: Number(row.id),
      order_id: String(row.order_id || ''),
      product_title: String(row.product_title || ''),
      item_number: row.item_number ? String(row.item_number) : null,
      sku: String(row.sku || ''),
      quantity: row.quantity,
      shipping_tracking_number: row.shipping_tracking_number
        ? String(row.shipping_tracking_number)
        : null,
      is_shipped: Boolean(row.is_shipped),
      status: row.status ? String(row.status) : null,
      ship_by_date: row.ship_by_date ? String(row.ship_by_date) : null,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
      has_manual: Boolean(row.has_manual),
    }));

    // Group by PST date
    const grouped = new Map<string, RecentOrder[]>();
    for (const order of orders) {
      const dateKey = order.created_at ? toPSTDateKey(new Date(order.created_at)) : 'unknown';
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);
      grouped.get(dateKey)!.push(order);
    }

    const today = toPSTDateKey(new Date());
    const yesterday = toPSTDateKey(new Date(Date.now() - 86_400_000));

    const groups: DateGroup[] = Array.from(grouped.entries()).map(([date, dateOrders]) => {
      let label = date;
      if (date === today) label = 'Today';
      else if (date === yesterday) label = 'Yesterday';
      return { date, label, orders: dateOrders };
    });

    return NextResponse.json({ groups, total: orders.length });
  } catch (err) {
    console.error('[/api/orders/recent] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch recent orders' }, { status: 500 });
  }
}
