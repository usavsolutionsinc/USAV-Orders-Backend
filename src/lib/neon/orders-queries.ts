import pool from '../db';

// Order record with shipping information
export interface ShippedOrder {
  id: number;
  ship_by_date: string;
  order_id: string;
  product_title: string;
  condition: string;
  shipping_tracking_number: string;
  serial_number: string; // Aggregated from tech_serial_numbers table
  sku: string;
  tested_by: number | null; // Staff ID - derived from first serial scan
  test_date_time: string | null; // Derived from first serial scan
  packed_by: number; // Staff ID (changed from boxed_by)
  pack_date_time: string;
  packer_photos_url: any; // JSONB array: [{url: string, index: number, uploadedAt: string}]
  account_source: string | null; // Account source (Amazon, eBay account name, etc.)
  notes: string;
  status_history: any; // JSONB status history
  is_shipped?: boolean;
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
          o.ship_by_date,
          o.order_id,
          o.product_title,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packed_by,
          o.pack_date_time,
          o.packer_photos_url,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tester_id) as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
        WHERE (o.is_shipped = true OR o.is_shipped::text = 'true')
          AND o.packed_by IS NOT NULL
        GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.condition,
                 o.shipping_tracking_number, o.sku, o.packed_by,
                 o.pack_date_time, o.packer_photos_url, o.account_source, o.notes, o.status_history, o.is_shipped
      )
      SELECT 
        os.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id
      ORDER BY os.pack_date_time DESC NULLS LAST, os.id DESC
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
          o.ship_by_date,
          o.order_id,
          o.product_title,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packed_by,
          o.pack_date_time,
          o.packer_photos_url,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tester_id) as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
        WHERE o.id = $1 AND COALESCE(o.is_shipped, false) = true
        GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.condition,
                 o.shipping_tracking_number, o.sku, o.packed_by,
                 o.pack_date_time, o.packer_photos_url, o.account_source, o.notes, o.status_history, o.is_shipped
      )
      SELECT 
        os.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id`,
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
    const result = await pool.query(
      `WITH order_serials AS (
        SELECT 
          o.id,
          o.ship_by_date,
          o.order_id,
          o.product_title,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packed_by,
          o.pack_date_time,
          o.packer_photos_url,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tester_id) as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
        WHERE COALESCE(o.is_shipped, false) = true
          AND o.packed_by IS NOT NULL
          AND (
            o.shipping_tracking_number ILIKE $1
            OR o.order_id ILIKE $1
            OR o.product_title ILIKE $1
            OR tsn.serial_number ILIKE $1
            OR o.sku ILIKE $1
          )
        GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.condition,
                 o.shipping_tracking_number, o.sku, o.packed_by,
                 o.pack_date_time, o.packer_photos_url, o.account_source, o.notes, o.status_history, o.is_shipped
      )
      SELECT 
        os.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id
      ORDER BY 
        CASE 
          WHEN os.pack_date_time IS NOT NULL AND os.pack_date_time != '1' 
          THEN os.pack_date_time::text 
          ELSE '9999-12-31' 
        END DESC,
        os.id DESC
      LIMIT 100`,
      [searchTerm]
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
    // Note: serial_number, tested_by, test_date_time removed - now in tech_serial_numbers table
    const allowedFields = [
      'packed_by',
      'pack_date_time',
      'notes',
      'is_shipped',
      'status_history'
    ];

    if (!allowedFields.includes(field)) {
      throw new Error(`Field ${field} is not allowed to be updated. Use tech_serial_numbers table for serial/test data.`);
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
          o.ship_by_date,
          o.order_id,
          o.product_title,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packed_by,
          o.pack_date_time,
          o.packer_photos_url,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tester_id) as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
        WHERE COALESCE(o.is_shipped, false) = true
          AND o.packed_by IS NOT NULL
          AND RIGHT(o.shipping_tracking_number, 8) = $1
        GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.condition,
                 o.shipping_tracking_number, o.sku, o.packed_by,
                 o.pack_date_time, o.packer_photos_url, o.account_source, o.notes, o.status_history, o.is_shipped
      )
      SELECT 
        os.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id
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
      `SELECT COUNT(*) as count 
       FROM orders 
       WHERE COALESCE(is_shipped, false) = true
         AND packed_by IS NOT NULL`
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error counting shipped orders:', error);
    throw new Error('Failed to count shipped orders');
  }
}
