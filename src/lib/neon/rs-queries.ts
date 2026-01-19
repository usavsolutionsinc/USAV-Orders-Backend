import pool from '../db';

// Neon DB RS Table Schema (based on user's screenshot):
// col_1: id (SERIAL PRIMARY KEY) - auto-increment
// col_2: Date / Time (TEXT)
// col_3: RS # (TEXT)
// col_4: Contact (TEXT)
// col_5: Product(s) (TEXT)
// col_6: Price (TEXT)
// col_7: Issue (TEXT)
// col_8: Serial # (TEXT)
// col_9: Parts (TEXT)
// col_10: Status (TEXT)
// col_11: Notes (TEXT) - for additional notes
// col_12: status_history (TEXT) - JSON string for status history

export interface RSRecord {
  id: number;
  date_time: string;
  rs_number: string;
  contact: string;
  product: string;
  price: string;
  issue: string;
  serial_number: string;
  parts: string;
  status: string;
  notes?: string;
  status_history?: StatusHistoryEntry[];
}

export interface StatusHistoryEntry {
  status: string;
  timestamp: string;
  previous_status?: string;
}

/**
 * Get all repairs with optional limit and offset for pagination
 */
export async function getAllRepairs(limit = 100, offset = 0): Promise<RSRecord[]> {
  try {
    const result = await pool.query(
      `SELECT 
        col_1 as id,
        col_2 as date_time,
        col_3 as rs_number,
        col_4 as contact,
        col_5 as product,
        col_6 as price,
        col_7 as issue,
        col_8 as serial_number,
        col_9 as parts,
        col_10 as status,
        col_11 as notes,
        col_12 as status_history
      FROM rs
      ORDER BY col_1 DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map(row => ({
      ...row,
      status_history: parseStatusHistory(row.status_history),
    }));
  } catch (error) {
    console.error('Error fetching repairs:', error);
    throw new Error('Failed to fetch repairs');
  }
}

/**
 * Get a single repair by ID
 */
export async function getRepairById(id: number): Promise<RSRecord | null> {
  try {
    const result = await pool.query(
      `SELECT 
        col_1 as id,
        col_2 as date_time,
        col_3 as rs_number,
        col_4 as contact,
        col_5 as product,
        col_6 as price,
        col_7 as issue,
        col_8 as serial_number,
        col_9 as parts,
        col_10 as status,
        col_11 as notes,
        col_12 as status_history
      FROM rs
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
    console.error('Error fetching repair by ID:', error);
    throw new Error('Failed to fetch repair');
  }
}

/**
 * Update repair status and append to status history
 */
export async function updateRepairStatus(id: number, newStatus: string): Promise<void> {
  try {
    // First, get current status
    const currentRepair = await getRepairById(id);
    if (!currentRepair) {
      throw new Error('Repair not found');
    }

    // Append to status history
    const history = currentRepair.status_history || [];
    history.push({
      status: newStatus,
      timestamp: new Date().toISOString(),
      previous_status: currentRepair.status,
    });

    const historyString = JSON.stringify(history);

    // Update status and history
    // For "Shipped" or "Picked Up", also update the date_time
    if (newStatus === 'Shipped' || newStatus === 'Picked Up') {
      await pool.query(
        'UPDATE rs SET col_10 = $1, col_12 = $2, col_2 = $3 WHERE col_1 = $4',
        [newStatus, historyString, new Date().toISOString(), id]
      );
    } else {
      await pool.query(
        'UPDATE rs SET col_10 = $1, col_12 = $2 WHERE col_1 = $3',
        [newStatus, historyString, id]
      );
    }
  } catch (error) {
    console.error('Error updating repair status:', error);
    throw new Error('Failed to update repair status');
  }
}

/**
 * Update repair notes
 */
export async function updateRepairNotes(id: number, notes: string): Promise<void> {
  try {
    await pool.query(
      'UPDATE rs SET col_11 = $1 WHERE col_1 = $2',
      [notes, id]
    );
  } catch (error) {
    console.error('Error updating repair notes:', error);
    throw new Error('Failed to update repair notes');
  }
}

/**
 * Update any repair field
 */
export async function updateRepairField(id: number, field: string, value: any): Promise<void> {
  try {
    const fieldMap: Record<string, string> = {
      date_time: 'col_2',
      rs_number: 'col_3',
      contact: 'col_4',
      product: 'col_5',
      price: 'col_6',
      issue: 'col_7',
      serial_number: 'col_8',
      parts: 'col_9',
      status: 'col_10',
      notes: 'col_11',
    };

    const dbColumn = fieldMap[field];
    if (!dbColumn) {
      throw new Error(`Invalid field: ${field}`);
    }

    await pool.query(
      `UPDATE rs SET ${dbColumn} = $1 WHERE col_1 = $2`,
      [value, id]
    );
  } catch (error) {
    console.error('Error updating repair field:', error);
    throw new Error('Failed to update repair field');
  }
}

/**
 * Search repairs by query string
 */
export async function searchRepairs(query: string): Promise<RSRecord[]> {
  try {
    const searchTerm = `%${query}%`;
    const result = await pool.query(
      `SELECT 
        col_1 as id,
        col_2 as date_time,
        col_3 as rs_number,
        col_4 as contact,
        col_5 as product,
        col_6 as price,
        col_7 as issue,
        col_8 as serial_number,
        col_9 as parts,
        col_10 as status,
        col_11 as notes,
        col_12 as status_history
      FROM rs
      WHERE 
        col_3 ILIKE $1 OR
        col_4 ILIKE $1 OR
        col_5 ILIKE $1 OR
        col_8 ILIKE $1
      ORDER BY col_1 DESC
      LIMIT 20`,
      [searchTerm]
    );

    return result.rows.map(row => ({
      ...row,
      status_history: parseStatusHistory(row.status_history),
    }));
  } catch (error) {
    console.error('Error searching repairs:', error);
    throw new Error('Failed to search repairs');
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
