import pool from '../db';

// Neon DB Shipped Table Schema (based on user's screenshot):
// col_1: id (SERIAL PRIMARY KEY) - auto-increment
// col_2: Date / Time (TEXT)
// col_3: Order ID (TEXT)
// col_4: Product Title (TEXT)
// col_5: Sent (TEXT)
// col_6: Shipping TRK # (TEXT)
// col_7: Serial # (TEXT)
// col_8: Boxed (TEXT)
// col_9: By (TEXT)
// col_10: SKU (TEXT)
// col_11: Status (TEXT)
// col_12: status_history (TEXT) - JSON string

export interface ShippedRecord {
  id: number;
  date_time: string;
  order_id: string;
  product_title: string;
  sent: string;
  shipping_trk_number: string;
  serial_number: string;
  boxed: string;
  by: string;
  sku: string;
  status: string;
  status_history?: StatusHistoryEntry[];
}

export interface StatusHistoryEntry {
  status: string;
  timestamp: string;
  previous_status?: string;
}

/**
 * Get all shipped records with optional limit and offset for pagination
 */
export async function getAllShipped(limit = 100, offset = 0): Promise<ShippedRecord[]> {
  try {
    const result = await pool.query(
      `SELECT 
        col_1 as id,
        col_2 as date_time,
        col_3 as order_id,
        col_4 as product_title,
        col_5 as sent,
        col_6 as shipping_trk_number,
        col_7 as serial_number,
        col_8 as boxed,
        col_9 as by,
        col_10 as sku,
        col_11 as status,
        col_12 as status_history
      FROM shipped
      ORDER BY col_1 DESC
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
        col_1 as id,
        col_2 as date_time,
        col_3 as order_id,
        col_4 as product_title,
        col_5 as sent,
        col_6 as shipping_trk_number,
        col_7 as serial_number,
        col_8 as boxed,
        col_9 as by,
        col_10 as sku,
        col_11 as status,
        col_12 as status_history
      FROM shipped
      WHERE col_1 = $1`,
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
    history.push({
      status: newStatus,
      timestamp: new Date().toISOString(),
      previous_status: currentRecord.status,
    });

    const historyString = JSON.stringify(history);

    // Update status and history
    // For "Shipped" or "Picked Up", also update the date_time
    if (newStatus === 'Shipped' || newStatus === 'Picked Up') {
      await pool.query(
        'UPDATE shipped SET col_11 = $1, col_12 = $2, col_2 = $3 WHERE col_1 = $4',
        [newStatus, historyString, new Date().toISOString(), id]
      );
    } else {
      await pool.query(
        'UPDATE shipped SET col_11 = $1, col_12 = $2 WHERE col_1 = $3',
        [newStatus, historyString, id]
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
    const fieldMap: Record<string, string> = {
      date_time: 'col_2',
      order_id: 'col_3',
      product_title: 'col_4',
      sent: 'col_5',
      shipping_trk_number: 'col_6',
      serial_number: 'col_7',
      boxed: 'col_8',
      by: 'col_9',
      sku: 'col_10',
      status: 'col_11',
    };

    const dbColumn = fieldMap[field];
    if (!dbColumn) {
      throw new Error(`Invalid field: ${field}`);
    }

    await pool.query(
      `UPDATE shipped SET ${dbColumn} = $1 WHERE col_1 = $2`,
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
        col_1 as id,
        col_2 as date_time,
        col_3 as order_id,
        col_4 as product_title,
        col_5 as sent,
        col_6 as shipping_trk_number,
        col_7 as serial_number,
        col_8 as boxed,
        col_9 as by,
        col_10 as sku,
        col_11 as status,
        col_12 as status_history
      FROM shipped
      WHERE 
        col_3 ILIKE $1 OR
        col_6 ILIKE $1 OR
        col_7 ILIKE $1 OR
        col_4 ILIKE $1
      ORDER BY col_1 DESC
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
function parseStatusHistory(historyString: string | null): StatusHistoryEntry[] {
  if (!historyString || historyString === '') return [];
  try {
    return JSON.parse(historyString);
  } catch {
    return [];
  }
}
