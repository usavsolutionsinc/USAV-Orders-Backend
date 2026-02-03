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
  tested_by: string;
  test_date_time: string;
  boxed_by: string;
  pack_date_time: string;
  quantity: string;
  days_late: string;
  notes: string;
}

/**
 * Get all shipped orders (is_shipped = true) with optional limit and offset for pagination
 */
export async function getAllShippedOrders(limit = 100, offset = 0): Promise<ShippedOrder[]> {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        ship_by_date,
        order_id,
        product_title,
        condition,
        shipping_tracking_number,
        serial_number,
        sku,
        tested_by,
        test_date_time,
        boxed_by,
        pack_date_time,
        quantity,
        days_late,
        notes
      FROM orders
      WHERE is_shipped = true
      ORDER BY id DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows;
  } catch (error) {
    console.error('Error fetching shipped orders:', error);
    throw new Error('Failed to fetch shipped orders');
  }
}

/**
 * Get a single shipped order by ID
 */
export async function getShippedOrderById(id: number): Promise<ShippedOrder | null> {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        ship_by_date,
        order_id,
        product_title,
        condition,
        shipping_tracking_number,
        serial_number,
        sku,
        tested_by,
        test_date_time,
        boxed_by,
        pack_date_time,
        quantity,
        days_late,
        notes
      FROM orders
      WHERE id = $1 AND is_shipped = true`,
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
        id,
        ship_by_date,
        order_id,
        product_title,
        condition,
        shipping_tracking_number,
        serial_number,
        sku,
        tested_by,
        test_date_time,
        boxed_by,
        pack_date_time,
        quantity,
        days_late,
        notes
      FROM orders
      WHERE is_shipped = true
        AND (
          shipping_tracking_number ILIKE $1
          OR order_id ILIKE $1
          OR product_title ILIKE $1
          OR serial_number ILIKE $1
          OR sku ILIKE $1
        )
      ORDER BY id DESC
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
      'boxed_by',
      'pack_date_time',
      'notes',
      'is_shipped'
    ];

    if (!allowedFields.includes(field)) {
      throw new Error(`Field ${field} is not allowed to be updated`);
    }

    await pool.query(
      `UPDATE orders SET ${field} = $1 WHERE id = $2 AND is_shipped = true`,
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
        id,
        ship_by_date,
        order_id,
        product_title,
        condition,
        shipping_tracking_number,
        serial_number,
        sku,
        tested_by,
        test_date_time,
        boxed_by,
        pack_date_time,
        quantity,
        days_late,
        notes
      FROM orders
      WHERE is_shipped = true
        AND RIGHT(shipping_tracking_number, 8) = $1
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
      'SELECT COUNT(*) as count FROM orders WHERE is_shipped = true'
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error counting shipped orders:', error);
    throw new Error('Failed to count shipped orders');
  }
}
