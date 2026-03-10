import pool from '../db';

// Order record with shipping information
export interface ShippedOrder {
  id: number;
  ship_by_date: string;
  order_id: string;
  product_title: string;
  quantity?: string | null;
  item_number?: string | null;
  condition: string;
  shipping_tracking_number: string;
  serial_number: string; // Aggregated from tech_serial_numbers
  sku: string;
  /** Staff ID assigned to test — sourced from work_assignments.assigned_tech_id */
  tester_id: number | null;
  tested_by: number | null;
  test_date_time: string | null;
  /** Staff ID assigned to pack — sourced from work_assignments.assigned_packer_id */
  packer_id: number | null;
  packed_by: number | null;
  pack_date_time: string | null;
  packer_photos_url: any;
  tracking_type: string | null;
  account_source: string | null;
  notes: string;
  status_history: any;
  is_shipped?: boolean;
  created_at: string | null;
  tested_by_name?: string | null;
  packed_by_name?: string | null;
  tester_name?: string | null;
  row_source?: 'order' | 'exception';
  exception_reason?: string | null;
  exception_status?: string | null;
}

export interface ActiveOrder {
  id: number;
  order_id: string;
  product_title: string;
  quantity: string | null;
  item_number: string | null;
  condition: string;
  shipping_tracking_number: string | null;
  sku: string | null;
  account_source: string | null;
  notes: string | null;
  status_history: any;
  is_shipped: boolean;
  ship_by_date: string | null;
  out_of_stock: string | null;
  created_at: string | null;
  tester_id: number | null;
  packer_id: number | null;
  tested_by: number | null;
  packed_by: number | null;
  pack_date_time: string | null;
  serial_number: string | null;
}

export interface CreateOrderParams {
  orderId: string;
  productTitle: string;
  shippingTrackingNumber?: string | null;
  sku?: string | null;
  accountSource?: string | null;
  condition?: string;
  quantity?: string | null;
  itemNumber?: string | null;
  shipByDate?: string | null;
  notes?: string | null;
  isShipped?: boolean;
}

// ─── Shared CTE fragments ─────────────────────────────────────────────────────

/**
 * The order_serials CTE: joins orders with work_assignments, packer_logs, tech_serial_numbers.
 * Returns all columns needed for ShippedOrder.
 */
const ORDER_SERIALS_CTE = `
  order_serials AS (
    SELECT
      o.id,
      to_char(o.ship_by_date, 'YYYY-MM-DD"T"HH24:MI:SS') AS ship_by_date,
      o.order_id,
      o.product_title,
      o.quantity,
      o.item_number,
      o.condition,
      o.shipping_tracking_number,
      o.sku,
      o.account_source,
      o.notes,
      o.status_history,
      o.is_shipped,
      to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
      'order'::text AS row_source,
      NULL::text AS exception_reason,
      NULL::text AS exception_status,
      wa_t.assigned_tech_id   AS tester_id,
      wa_p.assigned_packer_id AS packer_id,
      pl.packed_by,
      to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS pack_date_time,
      pl.packer_photos_url,
      pl.tracking_type,
      COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') AS serial_number,
      MIN(tsn.tested_by)::int AS tested_by,
      MIN(tsn.test_date_time)::text AS test_date_time
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT assigned_tech_id
      FROM work_assignments
      WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST'
        AND status IN ('ASSIGNED', 'IN_PROGRESS')
      ORDER BY created_at DESC LIMIT 1
    ) wa_t ON true
    LEFT JOIN LATERAL (
      SELECT assigned_packer_id
      FROM work_assignments
      WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'PACK'
        AND status IN ('ASSIGNED', 'IN_PROGRESS')
      ORDER BY created_at DESC LIMIT 1
    ) wa_p ON true
    LEFT JOIN LATERAL (
      SELECT
        pl.packed_by,
        pl.pack_date_time,
        pl.tracking_type,
        COALESCE((
          SELECT jsonb_agg(p.url ORDER BY p.created_at ASC)
          FROM photos p
          WHERE p.entity_type = 'PACKER_LOG'
            AND p.entity_id = pl.id
        ), '[]'::jsonb) AS packer_photos_url
      FROM packer_logs pl
      WHERE RIGHT(regexp_replace(pl.shipping_tracking_number, '\\D', '', 'g'), 8) =
            RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8)
      ORDER BY pack_date_time DESC NULLS LAST, pl.id DESC
      LIMIT 1
    ) pl ON true
    LEFT JOIN tech_serial_numbers tsn
      ON RIGHT(regexp_replace(tsn.shipping_tracking_number, '\\D', '', 'g'), 8) =
         RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8)
    WHERE COALESCE(o.is_shipped, false) = true
    GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.quantity, o.condition,
             o.item_number, o.shipping_tracking_number, o.sku,
             o.account_source, o.notes, o.status_history, o.is_shipped,
             wa_t.assigned_tech_id, wa_p.assigned_packer_id,
             pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
  )`;

// ─── Shipped Orders (Read) ────────────────────────────────────────────────────

/**
 * Get all shipped orders with optional limit and offset
 */
export async function getAllShippedOrders(limit = 100, offset = 0): Promise<ShippedOrder[]> {
  try {
    const result = await pool.query(
      `WITH ${ORDER_SERIALS_CTE}
       SELECT
         os.*,
         s1.name AS tested_by_name,
         s2.name AS packed_by_name,
         s3.name AS tester_name
       FROM order_serials os
       LEFT JOIN staff s1 ON os.tested_by = s1.id
       LEFT JOIN staff s2 ON os.packed_by = s2.id
       LEFT JOIN staff s3 ON os.tester_id = s3.id
       ORDER BY COALESCE(os.pack_date_time::timestamp, os.created_at::timestamp) DESC NULLS LAST, os.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return result.rows;
  } catch (error: any) {
    console.error('Error fetching shipped orders:', error.message);
    throw error;
  }
}

/**
 * Get a single shipped order by ID (orders table only, no exceptions)
 */
export async function getShippedOrderById(id: number): Promise<ShippedOrder | null> {
  try {
    const result = await pool.query(
      `WITH order_serials AS (
        SELECT
          o.id,
          to_char(o.ship_by_date, 'YYYY-MM-DD"T"HH24:MI:SS') AS ship_by_date,
          o.order_id,
          o.product_title,
          o.quantity,
          o.item_number,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
          wa_t.assigned_tech_id   AS tester_id,
          wa_p.assigned_packer_id AS packer_id,
          pl.packed_by,
          to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS pack_date_time,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') AS serial_number,
          MIN(tsn.tested_by)::int AS tested_by,
          MIN(tsn.test_date_time)::text AS test_date_time
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT assigned_tech_id FROM work_assignments
          WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST'
            AND status IN ('ASSIGNED', 'IN_PROGRESS')
          ORDER BY created_at DESC LIMIT 1
        ) wa_t ON true
        LEFT JOIN LATERAL (
          SELECT assigned_packer_id FROM work_assignments
          WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'PACK'
            AND status IN ('ASSIGNED', 'IN_PROGRESS')
          ORDER BY created_at DESC LIMIT 1
        ) wa_p ON true
        LEFT JOIN LATERAL (
          SELECT
            pl.packed_by,
            pl.pack_date_time,
            pl.tracking_type,
            COALESCE((
              SELECT jsonb_agg(p.url ORDER BY p.created_at ASC)
              FROM photos p
              WHERE p.entity_type = 'PACKER_LOG'
                AND p.entity_id = pl.id
            ), '[]'::jsonb) AS packer_photos_url
          FROM packer_logs pl
          WHERE shipping_tracking_number = o.shipping_tracking_number
          ORDER BY pack_date_time DESC NULLS LAST, id DESC LIMIT 1
        ) pl ON true
        LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
        WHERE o.id = $1 AND COALESCE(o.is_shipped, false) = true
        GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.quantity, o.condition,
                 o.item_number, o.shipping_tracking_number, o.sku,
                 o.account_source, o.notes, o.status_history, o.is_shipped,
                 wa_t.assigned_tech_id, wa_p.assigned_packer_id,
                 pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
      )
      SELECT os.*,
             s1.name AS tested_by_name,
             s2.name AS packed_by_name,
             s3.name AS tester_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id
      LEFT JOIN staff s3 ON os.tester_id = s3.id`,
      [id],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error fetching shipped order by ID:', error);
    throw new Error('Failed to fetch shipped order');
  }
}

/**
 * Search shipped orders by tracking number, order ID, product title, or serial number
 */
export async function searchShippedOrders(query: string): Promise<ShippedOrder[]> {
  try {
    const searchTerm = `%${query}%`;
    const digitsOnly = query.replace(/\D/g, '');
    const last8 = digitsOnly.slice(-8);
    const result = await pool.query(
      `WITH ${ORDER_SERIALS_CTE}
       SELECT
         os.*,
         s1.name AS tested_by_name,
         s2.name AS packed_by_name,
         s3.name AS tester_name
       FROM order_serials os
       LEFT JOIN staff s1 ON os.tested_by = s1.id
       LEFT JOIN staff s2 ON os.packed_by = s2.id
       LEFT JOIN staff s3 ON os.tester_id = s3.id
       WHERE
         os.shipping_tracking_number::text = $2
         OR os.order_id::text = $2
         OR os.shipping_tracking_number::text ILIKE $1
         OR os.order_id::text ILIKE $1
         OR os.product_title::text ILIKE $1
         OR os.sku::text ILIKE $1
         OR os.serial_number::text ILIKE $1
         OR (
           $3 != '' AND LENGTH($3) >= 8 AND (
             RIGHT(regexp_replace(os.shipping_tracking_number::text, '\\D', '', 'g'), 8) = $3
             OR RIGHT(os.order_id::text, 8) = $3
           )
         )
       ORDER BY
         CASE WHEN os.shipping_tracking_number::text = $2 OR os.order_id::text = $2 THEN 1 ELSE 2 END,
         COALESCE(os.pack_date_time::timestamp, os.created_at::timestamp) DESC NULLS LAST,
         os.id DESC
       LIMIT 100`,
      [searchTerm, query, last8],
    );
    return result.rows;
  } catch (error) {
    console.error('Error searching shipped orders:', error);
    throw new Error('Failed to search shipped orders');
  }
}

/**
 * Get shipped orders by tracking number (last-8 digits match)
 */
export async function getShippedOrderByTracking(tracking: string): Promise<ShippedOrder | null> {
  try {
    const last8 = tracking.slice(-8).toLowerCase();
    const result = await pool.query(
      `WITH ${ORDER_SERIALS_CTE}
       SELECT
         os.*,
         s1.name AS tested_by_name,
         s2.name AS packed_by_name,
         s3.name AS tester_name
       FROM order_serials os
       LEFT JOIN staff s1 ON os.tested_by = s1.id
       LEFT JOIN staff s2 ON os.packed_by = s2.id
       LEFT JOIN staff s3 ON os.tester_id = s3.id
       WHERE RIGHT(os.shipping_tracking_number, 8) = $1
       LIMIT 1`,
      [last8],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error fetching shipped order by tracking:', error);
    throw new Error('Failed to fetch shipped order by tracking');
  }
}

/**
 * Get count of shipped orders
 */
export async function getShippedOrdersCount(): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT id) AS count FROM orders WHERE COALESCE(is_shipped, false) = true`,
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error counting shipped orders:', error);
    throw new Error('Failed to count shipped orders');
  }
}

// ─── Active Orders (Read) ─────────────────────────────────────────────────────

/**
 * Get active (non-shipped) orders with assignment info
 */
export async function getActiveOrders(options?: {
  status?: string;
  assignedTechId?: number;
  assignedPackerId?: number;
  weekStart?: string;
  weekEnd?: string;
  missingTrackingOnly?: boolean;
  pendingOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ActiveOrder[]> {
  const conditions: string[] = ['COALESCE(o.is_shipped, false) = false'];
  const params: any[] = [];
  let idx = 1;

  if (options?.missingTrackingOnly) {
    conditions.push(`(o.shipping_tracking_number IS NULL OR o.shipping_tracking_number = '')`);
  }
  if (options?.weekStart) { conditions.push(`o.ship_by_date >= $${idx++}`); params.push(options.weekStart); }
  if (options?.weekEnd) { conditions.push(`o.ship_by_date <= $${idx++}`); params.push(options.weekEnd); }
  if (options?.assignedTechId != null) {
    conditions.push(`wa_t.assigned_tech_id = $${idx++}`);
    params.push(options.assignedTechId);
  }
  if (options?.assignedPackerId != null) {
    conditions.push(`wa_p.assigned_packer_id = $${idx++}`);
    params.push(options.assignedPackerId);
  }
  if (options?.pendingOnly) {
    conditions.push(`(wa_t.assigned_tech_id IS NULL OR wa_p.assigned_packer_id IS NULL)`);
  }

  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
       o.id,
       o.order_id,
       o.product_title,
       o.quantity,
       o.item_number,
       o.condition,
       o.shipping_tracking_number,
       o.sku,
       o.account_source,
       o.notes,
       o.status_history,
       COALESCE(o.is_shipped, false) AS is_shipped,
       to_char(o.ship_by_date, 'YYYY-MM-DD"T"HH24:MI:SS') AS ship_by_date,
       o.out_of_stock,
       to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
       wa_t.assigned_tech_id   AS tester_id,
       wa_p.assigned_packer_id AS packer_id,
       pl.packed_by,
       to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS pack_date_time,
       COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') AS serial_number,
       MIN(tsn.tested_by)::int AS tested_by
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT assigned_tech_id FROM work_assignments
       WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST'
         AND status IN ('ASSIGNED', 'IN_PROGRESS')
       ORDER BY created_at DESC LIMIT 1
     ) wa_t ON true
     LEFT JOIN LATERAL (
       SELECT assigned_packer_id FROM work_assignments
       WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'PACK'
         AND status IN ('ASSIGNED', 'IN_PROGRESS')
       ORDER BY created_at DESC LIMIT 1
     ) wa_p ON true
     LEFT JOIN LATERAL (
       SELECT packed_by, pack_date_time FROM packer_logs pl
       WHERE RIGHT(regexp_replace(pl.shipping_tracking_number, '\\D', '', 'g'), 8) =
             RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8)
       ORDER BY pack_date_time DESC NULLS LAST, pl.id DESC LIMIT 1
     ) pl ON true
     LEFT JOIN tech_serial_numbers tsn
       ON RIGHT(regexp_replace(tsn.shipping_tracking_number, '\\D', '', 'g'), 8) =
          RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8)
     WHERE ${conditions.join(' AND ')}
     GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.quantity, o.condition,
              o.item_number, o.shipping_tracking_number, o.sku, o.out_of_stock,
              o.account_source, o.notes, o.status_history, o.is_shipped,
              wa_t.assigned_tech_id, wa_p.assigned_packer_id,
              pl.packed_by, pl.pack_date_time
     ORDER BY o.ship_by_date ASC NULLS LAST, o.id ASC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return result.rows;
}

// ─── Orders (Write) ───────────────────────────────────────────────────────────

/**
 * Update a specific field in a shipped order
 */
export async function updateShippedOrderField(id: number, field: string, value: any): Promise<void> {
  const allowedFields = ['notes', 'is_shipped', 'status_history'];
  if (!allowedFields.includes(field)) {
    throw new Error(
      `Field '${field}' cannot be updated here. ` +
      `Use /api/orders/assign for assignment changes, ` +
      `tech_serial_numbers for serial/test data, or packer_logs for packing completion data.`,
    );
  }
  try {
    await pool.query(
      `UPDATE orders SET ${field} = $1 WHERE id = $2 AND COALESCE(is_shipped, false) = true`,
      [value, id],
    );
  } catch (error) {
    console.error('Error updating shipped order field:', error);
    throw new Error('Failed to update shipped order field');
  }
}

/**
 * Create a new order
 */
export async function createOrder(params: CreateOrderParams): Promise<ActiveOrder> {
  const result = await pool.query(
    `INSERT INTO orders
       (order_id, product_title, shipping_tracking_number, sku, account_source,
        condition, quantity, item_number, ship_by_date, notes, is_shipped)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      params.orderId,
      params.productTitle,
      params.shippingTrackingNumber ?? null,
      params.sku ?? null,
      params.accountSource ?? 'Manual',
      params.condition ?? 'Good',
      params.quantity ?? null,
      params.itemNumber ?? null,
      params.shipByDate ?? null,
      params.notes ?? null,
      params.isShipped ?? false,
    ],
  );
  return result.rows[0];
}

/**
 * Check if a tracking number already exists in orders (last-8 match)
 */
export async function trackingNumberExists(trackingNumber: string): Promise<boolean> {
  const last8 = trackingNumber.replace(/\D/g, '').slice(-8);
  const result = await pool.query(
    `SELECT 1 FROM orders
     WHERE RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $1
     LIMIT 1`,
    [last8],
  );
  return result.rowCount ? result.rowCount > 0 : false;
}

/**
 * Update order fields (general-purpose for active orders)
 */
export async function updateOrder(
  id: number,
  updates: Partial<{
    productTitle: string;
    shippingTrackingNumber: string | null;
    sku: string | null;
    condition: string;
    quantity: string | null;
    itemNumber: string | null;
    shipByDate: string | null;
    notes: string | null;
    isShipped: boolean;
    outOfStock: string | null;
    statusHistory: any;
    accountSource: string | null;
  }>,
): Promise<ActiveOrder | null> {
  const columnMap: Record<string, string> = {
    productTitle: 'product_title',
    shippingTrackingNumber: 'shipping_tracking_number',
    sku: 'sku',
    condition: 'condition',
    quantity: 'quantity',
    itemNumber: 'item_number',
    shipByDate: 'ship_by_date',
    notes: 'notes',
    isShipped: 'is_shipped',
    outOfStock: 'out_of_stock',
    statusHistory: 'status_history',
    accountSource: 'account_source',
  };

  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && columnMap[key]) {
      setClauses.push(`${columnMap[key]} = $${idx++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return null;

  params.push(id);
  const result = await pool.query(
    `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete an order by ID
 */
export async function deleteOrder(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM orders WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Skip an order (mark with a skip status in status_history)
 */
export async function skipOrder(id: number, reason?: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await pool.query(
    `UPDATE orders
     SET status_history = COALESCE(status_history, '[]'::jsonb) || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify([{ status: 'SKIPPED', timestamp: now, reason: reason ?? null }]), id],
  );
  return (result.rowCount ?? 0) > 0;
}
