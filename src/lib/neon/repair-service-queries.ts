import pool from '../db';
import { normalizePSTTimestamp } from '@/utils/date';

export interface RSRecord {
  id: number;
  created_at: string;
  updated_at: string;
  ticket_number: string;
  contact_info: string;
  product_title: string;
  price: string;
  issue: string;
  serial_number: string;
  status: string;
  notes?: string | null;
}

export const REPAIR_STATUS_OPTIONS = [
  'Awaiting Parts',
  'Pending Repair',
  'Awaiting Pickup',
  'Repaired, Contact Customer',
  'Awaiting Payment',
  'Awaiting Additional Parts Payment',
  'Shipped',
  'Picked Up',
] as const;

export type RepairStatus = typeof REPAIR_STATUS_OPTIONS[number];

function mapRepairRow(row: any): RSRecord {
  return {
    id: Number(row.id),
    created_at: normalizePSTTimestamp(row.created_at) || '',
    updated_at: normalizePSTTimestamp(row.updated_at) || '',
    ticket_number: row.ticket_number || '',
    contact_info: row.contact_info || '',
    product_title: row.product_title || '',
    price: row.price || '',
    issue: row.issue || '',
    serial_number: row.serial_number || '',
    status: row.status || 'Pending Repair',
    notes: row.notes ?? null,
  };
}

export async function getAllRepairs(limit = 100, offset = 0): Promise<RSRecord[]> {
  try {
    const result = await pool.query(
      `SELECT
         id,
         created_at,
         updated_at,
         ticket_number,
         contact_info,
         product_title,
         price,
         issue,
         serial_number,
         status,
         notes
       FROM repair_service
       ORDER BY created_at DESC NULLS LAST, id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return result.rows.map(mapRepairRow);
  } catch (error) {
    console.error('Error fetching repairs:', error);
    throw new Error('Failed to fetch repairs');
  }
}

export async function getRepairById(id: number): Promise<RSRecord | null> {
  try {
    const result = await pool.query(
      `SELECT
         id,
         created_at,
         updated_at,
         ticket_number,
         contact_info,
         product_title,
         price,
         issue,
         serial_number,
         status,
         notes
       FROM repair_service
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) return null;
    return mapRepairRow(result.rows[0]);
  } catch (error) {
    console.error('Error fetching repair by ID:', error);
    throw new Error('Failed to fetch repair');
  }
}

export async function updateRepairStatus(id: number, newStatus: string): Promise<void> {
  try {
    const result = await pool.query(
      'UPDATE repair_service SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, id],
    );
    if ((result.rowCount ?? 0) === 0) throw new Error('Repair not found');
  } catch (error) {
    console.error('Error updating repair status:', error);
    throw new Error('Failed to update repair status');
  }
}

export async function updateRepairNotes(id: number, notes: string): Promise<void> {
  try {
    await pool.query(
      'UPDATE repair_service SET notes = $1, updated_at = NOW() WHERE id = $2',
      [notes, id],
    );
  } catch (error) {
    console.error('Error updating repair notes:', error);
    throw new Error('Failed to update repair notes');
  }
}

export async function updateRepairField(id: number, field: string, value: any): Promise<void> {
  try {
    const validFields = [
      'ticket_number',
      'contact_info',
      'product_title',
      'price',
      'issue',
      'serial_number',
      'status',
      'notes',
    ];

    if (!validFields.includes(field)) throw new Error(`Invalid field: ${field}`);

    await pool.query(
      `UPDATE repair_service SET ${field} = $1, updated_at = NOW() WHERE id = $2`,
      [value, id],
    );
  } catch (error) {
    console.error('Error updating repair field:', error);
    throw new Error('Failed to update repair field');
  }
}

export interface CreateRepairParams {
  createdAt?: string;
  ticketNumber?: string | null;
  contactInfo: string;
  productTitle: string;
  price: string;
  issue: string;
  serialNumber: string;
  notes?: string | null;
  status?: string;
}

export async function createRepair(params: CreateRepairParams): Promise<RSRecord> {
  const createdAt = normalizePSTTimestamp(params.createdAt, { fallbackToNow: true })!;

  const result = await pool.query(
    `INSERT INTO repair_service
       (created_at, updated_at, ticket_number, contact_info, product_title, price, issue, serial_number, notes, status)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, ticket_number`,
    [
      createdAt,
      params.ticketNumber ?? null,
      params.contactInfo,
      params.productTitle,
      params.price,
      params.issue,
      params.serialNumber,
      params.notes ?? null,
      params.status ?? 'Pending Repair',
    ],
  );

  const { id } = result.rows[0];
  let ticketNumber = result.rows[0].ticket_number;

  if (!ticketNumber) {
    const fallback = `RS-${String(id).padStart(4, '0')}`;
    await pool.query(
      'UPDATE repair_service SET ticket_number = $1, updated_at = NOW() WHERE id = $2',
      [fallback, id],
    );
    ticketNumber = fallback;
  }

  const record = await getRepairById(id);
  return record!;
}

export async function searchRepairs(query: string): Promise<RSRecord[]> {
  try {
    const searchTerm = `%${query}%`;
    const result = await pool.query(
      `SELECT
         id,
         created_at,
         updated_at,
         ticket_number,
         contact_info,
         product_title,
         price,
         issue,
         serial_number,
         status,
         notes
       FROM repair_service
       WHERE ticket_number ILIKE $1
          OR contact_info ILIKE $1
          OR product_title ILIKE $1
          OR serial_number ILIKE $1
       ORDER BY created_at DESC NULLS LAST, id DESC
       LIMIT 20`,
      [searchTerm],
    );

    return result.rows.map(mapRepairRow);
  } catch (error) {
    console.error('Error searching repairs:', error);
    throw new Error('Failed to search repairs');
  }
}
