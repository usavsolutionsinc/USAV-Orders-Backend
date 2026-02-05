import pool from '../db';

// Order record with shipping information
export interface ShippedOrder {
  id: number;
  ship_by_date: string;
  order_id: string;
  product_title: string;
  condition: string;
  shipping_tracking_number: string;
  serial_number: string;
  sku: string;
  tested_by: number; // Staff ID
  test_date_time: string;
  packed_by: number; // Staff ID (changed from boxed_by)
  pack_date_time: string;
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
      `SELECT 
        o.id,
        o.ship_by_date,
        o.order_id,
        o.product_title,
        o.condition,
        o.shipping_tracking_number,
        o.serial_number,
        o.sku,
        o.tested_by,
        s1.name as tested_by_name,
        o.test_date_time,
        o.packed_by,
        s2.name as packed_by_name,
        o.pack_date_time,
        o.notes,
        o.status_history,
        o.is_shipped
      FROM orders o
      LEFT JOIN staff s1 ON o.tested_by = s1.id
      LEFT JOIN staff s2 ON o.packed_by = s2.id
      WHERE (o.is_shipped = true OR o.is_shipped::text = 'true')
        AND o.packed_by IS NOT NULL
      ORDER BY o.pack_date_time DESC NULLS LAST, o.id DESC
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
      `SELECT 
        o.id,
        o.ship_by_date,
        o.order_id,
        o.product_title,
        o.condition,
        o.shipping_tracking_number,
        o.serial_number,
        o.sku,
        o.tested_by,
        s1.name as tested_by_name,
        o.test_date_time,
        o.packed_by,
        s2.name as packed_by_name,
        o.pack_date_time,
        o.notes,
        o.status_history,
        o.is_shipped
      FROM orders o
      LEFT JOIN staff s1 ON o.tested_by = s1.id
      LEFT JOIN staff s2 ON o.packed_by = s2.id
      WHERE o.id = $1 AND COALESCE(o.is_shipped, false) = true`,
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
      `SELECT 
        o.id,
        o.ship_by_date,
        o.order_id,
        o.product_title,
        o.condition,
        o.shipping_tracking_number,
        o.serial_number,
        o.sku,
        o.tested_by,
        s1.name as tested_by_name,
        o.test_date_time,
        o.packed_by,
        s2.name as packed_by_name,
        o.pack_date_time,
        o.notes,
        o.status_history,
        o.is_shipped
      FROM orders o
      LEFT JOIN staff s1 ON o.tested_by = s1.id
      LEFT JOIN staff s2 ON o.packed_by = s2.id
      WHERE COALESCE(o.is_shipped, false) = true
        AND o.packed_by IS NOT NULL
        AND (
          o.shipping_tracking_number ILIKE $1
          OR o.order_id ILIKE $1
          OR o.product_title ILIKE $1
          OR o.serial_number ILIKE $1
          OR o.sku ILIKE $1
        )
      ORDER BY 
        CASE 
          WHEN o.pack_date_time IS NOT NULL AND o.pack_date_time != '1' 
          THEN o.pack_date_time::text 
          ELSE '9999-12-31' 
        END DESC,
        o.id DESC
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
    const allowedFields = [
      'serial_number',
      'tested_by',
      'test_date_time',
      'packed_by',
      'pack_date_time',
      'notes',
      'is_shipped',
      'status_history'
    ];

    if (!allowedFields.includes(field)) {
      throw new Error(`Field ${field} is not allowed to be updated`);
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
      `SELECT 
        o.id,
        o.ship_by_date,
        o.order_id,
        o.product_title,
        o.condition,
        o.shipping_tracking_number,
        o.serial_number,
        o.sku,
        o.tested_by,
        s1.name as tested_by_name,
        o.test_date_time,
        o.packed_by,
        s2.name as packed_by_name,
        o.pack_date_time,
        o.notes,
        o.status_history,
        o.is_shipped
      FROM orders o
      LEFT JOIN staff s1 ON o.tested_by = s1.id
      LEFT JOIN staff s2 ON o.packed_by = s2.id
      WHERE COALESCE(o.is_shipped, false) = true
        AND o.packed_by IS NOT NULL
        AND RIGHT(o.shipping_tracking_number, 8) = $1
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
