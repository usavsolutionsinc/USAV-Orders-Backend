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
  serial_number: string; // Aggregated from tech_serial_numbers table
  sku: string;
  tester_id: number | null; // Staff ID - who is assigned to test (from orders.tester_id)
  tested_by: number | null; // Staff ID - who actually tested (derived from first serial scan in tech_serial_numbers)
  test_date_time: string | null; // Derived from first serial scan
  packer_id: number | null; // Staff ID - who is assigned to pack (from orders.packer_id)
  packed_by: number | null; // Staff ID - who actually packed (from packer_logs.packed_by)
  pack_date_time: string | null; // Derived from packer_logs.pack_date_time
  packer_photos_url: any; // JSONB array from packer_logs: [{url: string, index: number, uploadedAt: string}]
  tracking_type: string | null; // Carrier type from packer_logs (UPS, USPS, FEDEX, ORDERS, etc.)
  account_source: string | null; // Account source (Amazon, eBay account name, etc.)
  notes: string;
  status_history: any; // JSONB status history
  is_shipped?: boolean;
  created_at: string | null;
  tested_by_name?: string | null;
  packed_by_name?: string | null;
  tester_name?: string | null;
  row_source?: 'order' | 'exception';
  exception_reason?: string | null;
  exception_status?: string | null;
}

/**
 * Get all shipped orders (is_shipped = true) with optional limit and offset for pagination
 */
export async function getAllShippedOrders(limit = 100, offset = 0): Promise<ShippedOrder[]> {
  try {
    const result = await pool.query(
      `WITH order_serials AS (
        SELECT 
          o.id,
          to_char(o.ship_by_date, 'YYYY-MM-DD"T"HH24:MI:SS') as ship_by_date,
          o.order_id,
          o.product_title,
          o.quantity,
          o.item_number,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packer_id,
          o.tester_id,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as created_at,
          'order'::text as row_source,
          NULL::text as exception_reason,
          NULL::text as exception_status,
          pl.packed_by,
          to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') as pack_date_time,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tested_by)::int as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT packed_by, pack_date_time, packer_photos_url, tracking_type
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
                 o.item_number, o.shipping_tracking_number, o.sku, o.packer_id, o.tester_id,
                 o.account_source, o.notes, o.status_history, o.is_shipped,
                 pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
      ),
      exception_serials AS (
        SELECT
          (-oe.id) as id,
          NULL::text as ship_by_date,
          COALESCE(o.order_id, 'EXC-' || oe.id::text) as order_id,
          COALESCE(o.product_title, 'Unknown Product (Exception)') as product_title,
          COALESCE(o.quantity, '1') as quantity,
          o.item_number,
          COALESCE(o.condition, 'Unknown') as condition,
          oe.shipping_tracking_number,
          COALESCE(o.sku, '') as sku,
          o.packer_id,
          o.tester_id,
          COALESCE(o.account_source, 'Exception') as account_source,
          COALESCE(oe.notes, '') as notes,
          COALESCE(o.status_history, '[]'::jsonb) as status_history,
          COALESCE(o.is_shipped, false) as is_shipped,
          to_char(oe.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as created_at,
          'exception'::text as row_source,
          oe.exception_reason,
          oe.status as exception_status,
          pl.packed_by,
          to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') as pack_date_time,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tested_by)::int as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders_exceptions oe
        LEFT JOIN LATERAL (
          SELECT id, order_id, product_title, quantity, item_number, condition, sku, packer_id, tester_id, account_source, status_history, is_shipped
          FROM orders o
          WHERE o.shipping_tracking_number IS NOT NULL
            AND o.shipping_tracking_number != ''
            AND RIGHT(o.shipping_tracking_number, 8) = RIGHT(oe.shipping_tracking_number, 8)
          ORDER BY o.id DESC
          LIMIT 1
        ) o ON true
        LEFT JOIN LATERAL (
          SELECT packed_by, pack_date_time, packer_photos_url, tracking_type
          FROM packer_logs pl
          WHERE RIGHT(pl.shipping_tracking_number, 8) = RIGHT(oe.shipping_tracking_number, 8)
          ORDER BY pack_date_time DESC NULLS LAST, pl.id DESC
          LIMIT 1
        ) pl ON true
        LEFT JOIN tech_serial_numbers tsn
          ON RIGHT(tsn.shipping_tracking_number, 8) = RIGHT(oe.shipping_tracking_number, 8)
        GROUP BY
          oe.id, oe.shipping_tracking_number, oe.exception_reason, oe.status, oe.notes, oe.created_at,
          o.order_id, o.product_title, o.quantity, o.item_number, o.condition, o.sku, o.packer_id, o.tester_id,
          o.account_source, o.status_history, o.is_shipped,
          pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
      ),
      combined AS (
        SELECT * FROM order_serials
        UNION ALL
        SELECT * FROM exception_serials
      )
      SELECT 
        c.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name,
        s3.name as tester_name
      FROM combined c
      LEFT JOIN staff s1 ON c.tested_by = s1.id
      LEFT JOIN staff s2 ON c.packed_by = s2.id
      LEFT JOIN staff s3 ON c.tester_id = s3.id
      ORDER BY COALESCE(c.pack_date_time::timestamp, c.created_at::timestamp) DESC NULLS LAST, c.id DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows;
  } catch (error: any) {
    console.error('Error fetching shipped orders:', error);
    console.error('Error details:', error.message, error.stack);
    throw error;
  }
}

/**
 * Get a single shipped order by ID
 */
export async function getShippedOrderById(id: number): Promise<ShippedOrder | null> {
  try {
    const result = await pool.query(
      `WITH order_serials AS (
        SELECT 
          o.id,
          to_char(o.ship_by_date, 'YYYY-MM-DD"T"HH24:MI:SS') as ship_by_date,
          o.order_id,
          o.product_title,
          o.quantity,
          o.item_number,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packer_id,
          o.tester_id,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as created_at,
          pl.packed_by,
          to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') as pack_date_time,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tested_by)::int as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT packed_by, pack_date_time, packer_photos_url, tracking_type
          FROM packer_logs
          WHERE shipping_tracking_number = o.shipping_tracking_number
          ORDER BY pack_date_time DESC NULLS LAST, id DESC
          LIMIT 1
        ) pl ON true
        LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
        WHERE o.id = $1 AND COALESCE(o.is_shipped, false) = true
        GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.quantity, o.condition,
                 o.item_number, o.shipping_tracking_number, o.sku, o.packer_id, o.tester_id,
                 o.account_source, o.notes, o.status_history, o.is_shipped,
                 pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
      )
      SELECT 
        os.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name,
        s3.name as tester_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id
      LEFT JOIN staff s3 ON os.tester_id = s3.id`,
      [id]
    );

    return result.rows[0] || null;
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
      `WITH order_serials AS (
        SELECT 
          o.id,
          to_char(o.ship_by_date, 'YYYY-MM-DD"T"HH24:MI:SS') as ship_by_date,
          o.order_id,
          o.product_title,
          o.quantity,
          o.item_number,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packer_id,
          o.tester_id,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as created_at,
          'order'::text as row_source,
          NULL::text as exception_reason,
          NULL::text as exception_status,
          pl.packed_by,
          to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') as pack_date_time,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tested_by)::int as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT packed_by, pack_date_time, packer_photos_url, tracking_type
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
                 o.item_number, o.shipping_tracking_number, o.sku, o.packer_id, o.tester_id,
                 o.account_source, o.notes, o.status_history, o.is_shipped,
                 pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
      ),
      exception_serials AS (
        SELECT
          (-oe.id) as id,
          NULL::text as ship_by_date,
          COALESCE(o.order_id, 'EXC-' || oe.id::text) as order_id,
          COALESCE(o.product_title, 'Unknown Product (Exception)') as product_title,
          COALESCE(o.quantity, '1') as quantity,
          o.item_number,
          COALESCE(o.condition, 'Unknown') as condition,
          oe.shipping_tracking_number,
          COALESCE(o.sku, '') as sku,
          o.packer_id,
          o.tester_id,
          COALESCE(o.account_source, 'Exception') as account_source,
          COALESCE(oe.notes, '') as notes,
          COALESCE(o.status_history, '[]'::jsonb) as status_history,
          COALESCE(o.is_shipped, false) as is_shipped,
          to_char(oe.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as created_at,
          'exception'::text as row_source,
          oe.exception_reason,
          oe.status as exception_status,
          pl.packed_by,
          to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') as pack_date_time,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tested_by)::int as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders_exceptions oe
        LEFT JOIN LATERAL (
          SELECT id, order_id, product_title, quantity, item_number, condition, sku, packer_id, tester_id, account_source, status_history, is_shipped
          FROM orders o
          WHERE o.shipping_tracking_number IS NOT NULL
            AND o.shipping_tracking_number != ''
            AND RIGHT(o.shipping_tracking_number, 8) = RIGHT(oe.shipping_tracking_number, 8)
          ORDER BY o.id DESC
          LIMIT 1
        ) o ON true
        LEFT JOIN LATERAL (
          SELECT packed_by, pack_date_time, packer_photos_url, tracking_type
          FROM packer_logs pl
          WHERE RIGHT(pl.shipping_tracking_number, 8) = RIGHT(oe.shipping_tracking_number, 8)
          ORDER BY pack_date_time DESC NULLS LAST, pl.id DESC
          LIMIT 1
        ) pl ON true
        LEFT JOIN tech_serial_numbers tsn
          ON RIGHT(tsn.shipping_tracking_number, 8) = RIGHT(oe.shipping_tracking_number, 8)
        GROUP BY
          oe.id, oe.shipping_tracking_number, oe.exception_reason, oe.status, oe.notes, oe.created_at,
          o.order_id, o.product_title, o.quantity, o.item_number, o.condition, o.sku, o.packer_id, o.tester_id,
          o.account_source, o.status_history, o.is_shipped,
          pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
      ),
      combined AS (
        SELECT * FROM order_serials
        UNION ALL
        SELECT * FROM exception_serials
      )
      SELECT 
        c.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name,
        s3.name as tester_name
      FROM combined c
      LEFT JOIN staff s1 ON c.tested_by = s1.id
      LEFT JOIN staff s2 ON c.packed_by = s2.id
      LEFT JOIN staff s3 ON c.tester_id = s3.id
      WHERE
        c.shipping_tracking_number::text = $2
        OR c.order_id::text = $2
        OR c.shipping_tracking_number::text ILIKE $1
        OR c.order_id::text ILIKE $1
        OR c.product_title::text ILIKE $1
        OR c.sku::text ILIKE $1
        OR c.serial_number::text ILIKE $1
        OR (
          $3 != '' AND LENGTH($3) >= 8 AND (
            RIGHT(regexp_replace(c.shipping_tracking_number::text, '\\D', '', 'g'), 8) = $3
            OR RIGHT(c.order_id::text, 8) = $3
          )
        )
      ORDER BY 
        CASE 
          WHEN c.shipping_tracking_number::text = $2 OR c.order_id::text = $2 THEN 1
          ELSE 2
        END,
        c.id DESC
      LIMIT 100`,
      [searchTerm, query, last8]
    );

    return result.rows;
  } catch (error) {
    console.error('Error searching shipped orders:', error);
    throw new Error('Failed to search shipped orders');
  }
}

/**
 * Update a specific field in a shipped order
 */
export async function updateShippedOrderField(
  id: number,
  field: string,
  value: any
): Promise<void> {
  try {
    // Note: Fields moved to other tables:
    // - serial_number, tested_by, test_date_time -> tech_serial_numbers table
    // - packed_by, pack_date_time, packer_photos_url -> packer_logs table
    const allowedFields = [
      'packer_id',
      'tester_id',
      'notes',
      'is_shipped',
      'status_history'
    ];

    if (!allowedFields.includes(field)) {
      throw new Error(`Field ${field} is not allowed to be updated. Use tech_serial_numbers for serial/test data, or packer_logs for packing completion data.`);
    }

    await pool.query(
      `UPDATE orders SET ${field} = $1 WHERE id = $2 AND COALESCE(is_shipped, false) = true`,
      [value, id]
    );
  } catch (error) {
    console.error('Error updating shipped order field:', error);
    throw new Error('Failed to update shipped order field');
  }
}

/**
 * Get shipped orders by tracking number (last 8 digits match)
 */
export async function getShippedOrderByTracking(tracking: string): Promise<ShippedOrder | null> {
  try {
    const last8 = tracking.slice(-8).toLowerCase();
    const result = await pool.query(
      `WITH order_serials AS (
        SELECT 
          o.id,
          to_char(o.ship_by_date, 'YYYY-MM-DD"T"HH24:MI:SS') as ship_by_date,
          o.order_id,
          o.product_title,
          o.quantity,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packer_id,
          o.tester_id,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          pl.packed_by,
          to_char(pl.pack_date_time, 'YYYY-MM-DD"T"HH24:MI:SS') as pack_date_time,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tested_by) as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT packed_by, pack_date_time, packer_photos_url, tracking_type
          FROM packer_logs
          WHERE shipping_tracking_number = o.shipping_tracking_number
          ORDER BY pack_date_time DESC NULLS LAST, id DESC
          LIMIT 1
        ) pl ON true
        LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
        WHERE COALESCE(o.is_shipped, false) = true
          AND RIGHT(o.shipping_tracking_number, 8) = $1
        GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.quantity, o.condition,
                 o.shipping_tracking_number, o.sku, o.packer_id, o.tester_id,
                 o.account_source, o.notes, o.status_history, o.is_shipped,
                 pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
      )
      SELECT 
        os.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name,
        s3.name as tester_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id
      LEFT JOIN staff s3 ON os.tester_id = s3.id
      LIMIT 1`,
      [last8]
    );

    return result.rows[0] || null;
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
      `SELECT COUNT(DISTINCT id) as count 
       FROM orders
       WHERE COALESCE(is_shipped, false) = true`
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error counting shipped orders:', error);
    throw new Error('Failed to count shipped orders');
  }
}
