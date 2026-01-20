import pool from '../db';

// Neon DB Shipped Table Schema:
// id (SERIAL PRIMARY KEY) - auto-increment
// date_time (TEXT)
// order_id (TEXT)
// product_title (TEXT)
// condition (TEXT)
// shipping_tracking_number (TEXT)
// serial_number (TEXT)
// boxed_by (TEXT)
// tested_by (TEXT)
// sku (TEXT)
// status (TEXT)
// status_history (JSON) - tracks status changes with timestamps

export interface StatusHistoryEntry {
  status: string;
  timestamp: string;
  previous_status?: string;
}

export interface ShippedRecord {
  id: number;
  date_time: string;
  order_id: string;
  product_title: string;
  condition: string;
  shipping_tracking_number: string;
  serial_number: string;
  boxed_by: string;
  tested_by: string;
  sku: string;
  status: string;
  status_history?: StatusHistoryEntry[];
}

/**
 * Get all shipped records with optional limit and offset for pagination
 */
export async function getAllShipped(limit = 100, offset = 0): Promise<ShippedRecord[]> {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        date_time,
        order_id,
        product_title,
        condition,
        shipping_tracking_number,
        serial_number,
        boxed_by,
        tested_by,
        sku,
        status,
        status_history
      FROM shipped
      ORDER BY id DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map(row => ({
      ...row,
      status_history: parseStatusHistory(row.status_history),
    }));
  } catch (error) {
    console.error('Error fetching shipped records:', error);
    throw new Error('Failed to fetch shipped records');
  }
}

/**
 * Get a single shipped record by ID
 */
export async function getShippedById(id: number): Promise<ShippedRecord | null> {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        date_time,
        order_id,
        product_title,
        condition,
        shipping_tracking_number,
        serial_number,
        boxed_by,
        tested_by,
        sku,
        status,
        status_history
      FROM shipped
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      ...row,
      status_history: parseStatusHistory(row.status_history),
    };
  } catch (error) {
    console.error('Error fetching shipped record by ID:', error);
    throw new Error('Failed to fetch shipped record');
  }
}

/**
 * Update shipped status and append to status history
 */
export async function updateShippedStatus(id: number, newStatus: string): Promise<void> {
  try {
    // First, get current status
    const currentRecord = await getShippedById(id);
    if (!currentRecord) {
      throw new Error('Shipped record not found');
    }

    // Append to status history
    const history = currentRecord.status_history || [];
    const now = new Date().toISOString();
    
    history.push({
      status: newStatus,
      timestamp: now,
      previous_status: currentRecord.status,
    });

    const historyJson = JSON.stringify(history);

    // Update status and history
    // For "Shipped" or "Picked Up", also update the date_time
    if (newStatus === 'Shipped' || newStatus === 'Picked Up') {
      await pool.query(
        'UPDATE shipped SET status = $1, status_history = $2, date_time = $3 WHERE id = $4',
        [newStatus, historyJson, now, id]
      );
    } else {
      await pool.query(
        'UPDATE shipped SET status = $1, status_history = $2 WHERE id = $3',
        [newStatus, historyJson, id]
      );
    }
  } catch (error) {
    console.error('Error updating shipped status:', error);
    throw new Error('Failed to update shipped status');
  }
}

/**
 * Update any shipped field
 */
export async function updateShippedField(id: number, field: string, value: any): Promise<void> {
  try {
    const validFields = [
      'date_time',
      'order_id',
      'product_title',
      'condition',
      'shipping_tracking_number',
      'serial_number',
      'boxed_by',
      'tested_by',
      'sku',
      'status',
    ];

    if (!validFields.includes(field)) {
      throw new Error(`Invalid field: ${field}`);
    }

    await pool.query(
      `UPDATE shipped SET ${field} = $1 WHERE id = $2`,
      [value, id]
    );
  } catch (error) {
    console.error('Error updating shipped field:', error);
    throw new Error('Failed to update shipped field');
  }
}

/**
 * Search shipped records by query string
 */
export async function searchShipped(query: string): Promise<ShippedRecord[]> {
  try {
    const searchTerm = `%${query}%`;
    const result = await pool.query(
      `SELECT 
        id,
        date_time,
        order_id,
        product_title,
        condition,
        shipping_tracking_number,
        serial_number,
        boxed_by,
        tested_by,
        sku,
        status,
        status_history
      FROM shipped
      WHERE 
        order_id ILIKE $1 OR
        shipping_tracking_number ILIKE $1 OR
        serial_number ILIKE $1 OR
        product_title ILIKE $1
      ORDER BY id DESC
      LIMIT 20`,
      [searchTerm]
    );

    return result.rows.map(row => ({
      ...row,
      status_history: parseStatusHistory(row.status_history),
    }));
  } catch (error) {
    console.error('Error searching shipped records:', error);
    throw new Error('Failed to search shipped records');
  }
}

/**
 * Parse status history JSON string
 */
function parseStatusHistory(historyString: any): StatusHistoryEntry[] {
  if (!historyString) return [];
  
  // If it's already an object/array, return it
  if (typeof historyString === 'object') {
    return Array.isArray(historyString) ? historyString : [];
  }
  
  // If it's a string, try to parse it
  if (typeof historyString === 'string') {
    try {
      return JSON.parse(historyString);
    } catch {
      return [];
    }
  }
  
  return [];
}
