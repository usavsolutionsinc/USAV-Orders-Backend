import pool from '../db';

// Neon DB Repair Service Table Schema:
// id (SERIAL PRIMARY KEY) - auto-increment
// date_time (TEXT)
// ticket_number (TEXT) - formerly "RS #"
// contact (TEXT)
// product_title (TEXT) - formerly "Product(s)"
// price (TEXT)
// issue (TEXT)
// serial_number (TEXT) - formerly "Serial #"
// parts_needed (TEXT) - formerly "Parts"
// status (TEXT)
// notes (TEXT)
// status_history (JSON) - tracks status changes with timestamps

export interface StatusHistoryEntry {
  status: string;
  timestamp: string;
  previous_status?: string;
}

export interface RSRecord {
  id: number;
  date_time: string;
  ticket_number: string;
  contact: string;
  product_title: string;
  price: string;
  issue: string;
  serial_number: string;
  parts_needed: string;
  status: string;
  notes?: string;
  status_history?: StatusHistoryEntry[];
}

// Valid status options for repair service
export const REPAIR_STATUS_OPTIONS = [
  "Awaiting Parts",
  "Pending Repair",
  "Awaiting Pickup",
  "Repaired, Contact Customer",
  "Awaiting Payment",
  "Awaiting Additional Parts Payment",
  "Shipped",
  "Picked Up"
] as const;

export type RepairStatus = typeof REPAIR_STATUS_OPTIONS[number];

/**
 * Get all repairs with optional limit and offset for pagination
 */
export async function getAllRepairs(limit = 100, offset = 0): Promise<RSRecord[]> {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        date_time,
        ticket_number,
        contact,
        product_title,
        price,
        issue,
        serial_number,
        parts_needed,
        status,
        notes,
        status_history
      FROM repair_service
      ORDER BY id DESC
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
        id,
        date_time,
        ticket_number,
        contact,
        product_title,
        price,
        issue,
        serial_number,
        parts_needed,
        status,
        notes,
        status_history
      FROM repair_service
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
    const now = new Date().toISOString();
    
    history.push({
      status: newStatus,
      timestamp: now,
      previous_status: currentRepair.status,
    });

    const historyJson = JSON.stringify(history);

    // Update status and history
    // For "Shipped" or "Picked Up", also update the date_time
    if (newStatus === 'Shipped' || newStatus === 'Picked Up') {
      await pool.query(
        'UPDATE repair_service SET status = $1, status_history = $2, date_time = $3 WHERE id = $4',
        [newStatus, historyJson, now, id]
      );
    } else {
      await pool.query(
        'UPDATE repair_service SET status = $1, status_history = $2 WHERE id = $3',
        [newStatus, historyJson, id]
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
      'UPDATE repair_service SET notes = $1 WHERE id = $2',
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
    const validFields = [
      'date_time',
      'ticket_number',
      'contact',
      'product_title',
      'price',
      'issue',
      'serial_number',
      'parts_needed',
      'status',
      'notes',
    ];

    if (!validFields.includes(field)) {
      throw new Error(`Invalid field: ${field}`);
    }

    await pool.query(
      `UPDATE repair_service SET ${field} = $1 WHERE id = $2`,
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
        id,
        date_time,
        ticket_number,
        contact,
        product_title,
        price,
        issue,
        serial_number,
        parts_needed,
        status,
        notes,
        status_history
      FROM repair_service
      WHERE 
        ticket_number ILIKE $1 OR
        contact ILIKE $1 OR
        product_title ILIKE $1 OR
        serial_number ILIKE $1
      ORDER BY id DESC
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
