import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentPSTDateKey, normalizePSTTimestamp, toPSTDateKey } from '@/utils/date';
import { logRouteMetric } from '@/lib/route-metrics';

interface RecentOrder {
  id: number;
  shipment_id: number | null;
  order_id: string;
  product_title: string;
  item_number: string | null;
  sku: string;
  quantity: string | number | null;
  tracking_number: string | null;
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
  const startedAt = Date.now();
  let ok = false;
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 1), 60);
    const query = searchParams.get('q') || '';

    let sql = `
      SELECT
        o.id,
        o.shipment_id,
        o.order_id,
        o.product_title,
        o.item_number,
        o.sku,
        o.quantity,
        stn.tracking_number_raw AS tracking_number,
        COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
        o.status,
        to_char(wa_deadline.deadline_at, 'YYYY-MM-DD') AS ship_by_date,
        o.created_at,
        EXISTS (
          SELECT 1 FROM product_manuals pm
          WHERE pm.is_active = true
            AND o.item_number IS NOT NULL
            AND o.item_number <> ''
            AND regexp_replace(UPPER(TRIM(COALESCE(pm.item_number, ''))), '[^A-Z0-9]', '', 'g') =
                regexp_replace(UPPER(TRIM(o.item_number)), '[^A-Z0-9]', '', 'g')
        ) AS has_manual
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT wa.deadline_at FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
        ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                 wa.updated_at DESC, wa.id DESC LIMIT 1
      ) wa_deadline ON TRUE
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
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
        OR COALESCE(stn.tracking_number_raw, '') ILIKE $${paramCount}
      )`;
      params.push(`%${query.trim()}%`);
      paramCount++;
    }

    sql += ' ORDER BY o.created_at DESC LIMIT 500';

    const result = await pool.query(sql, params);
    const orders: RecentOrder[] = result.rows.map((row) => ({
      id: Number(row.id),
      shipment_id: row.shipment_id ? Number(row.shipment_id) : null,
      order_id: String(row.order_id || ''),
      product_title: String(row.product_title || ''),
      item_number: row.item_number ? String(row.item_number) : null,
      sku: String(row.sku || ''),
      quantity: row.quantity,
      tracking_number: row.tracking_number ? String(row.tracking_number) : null,
      is_shipped: Boolean(row.is_shipped),
      status: row.status ? String(row.status) : null,
      ship_by_date: row.ship_by_date ? String(row.ship_by_date) : null,
      created_at: normalizePSTTimestamp(row.created_at) || '',
      has_manual: Boolean(row.has_manual),
    }));

    // Group by PST date
    const grouped = new Map<string, RecentOrder[]>();
    for (const order of orders) {
      const dateKey = order.created_at ? toPSTDateKey(order.created_at) : 'unknown';
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);
      grouped.get(dateKey)!.push(order);
    }

    const today = getCurrentPSTDateKey();
    const yesterday = toPSTDateKey(new Date(Date.now() - 86_400_000));

    const groups: DateGroup[] = Array.from(grouped.entries()).map(([date, dateOrders]) => {
      let label = date;
      if (date === today) label = 'Today';
      else if (date === yesterday) label = 'Yesterday';
      return { date, label, orders: dateOrders };
    });

    ok = true;
    return NextResponse.json({ groups, total: orders.length });
  } catch (err) {
    console.error('[/api/orders/recent] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch recent orders' }, { status: 500 });
  } finally {
    logRouteMetric({
      route: '/api/orders/recent',
      method: 'GET',
      startedAt,
      ok,
    });
  }
}
