import pool from '../db';
import { normalizePSTTimestamp } from '@/utils/date';

export interface ReceivingLog {
  id: number;
  tracking_number: string;
  carrier: string | null;
  received_at: string | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  is_return: boolean | null;
  return_platform: string | null;
  needs_test: boolean | null;
  assigned_tech_id: number | null;
  target_channel: string | null;
  unboxed_by: number | null;
  unboxed_at: string | null;
  zoho_po_id: string | null;
  zoho_pr_id: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface ReceivingLine {
  id: number;
  receiving_id: number | null;
  zoho_item_id: string | null;
  item_name: string | null;
  sku: string | null;
  quantity_received: number | null;
  quantity_expected: number | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  disposition_audit: any;
  notes: string | null;
  created_at: string | null;
}

export interface ReceivingPhoto {
  id: number;
  receiving_id: number;
  url: string;
  uploaded_at: string | null;
}

export interface CreateReceivingLogParams {
  trackingNumber: string;
  carrier?: string | null;
  receivedAt?: string | null;
  qaStatus?: string | null;
  dispositionCode?: string | null;
  conditionGrade?: string | null;
  isReturn?: boolean;
  returnPlatform?: string | null;
  needsTest?: boolean;
  assignedTechId?: number | null;
  targetChannel?: string | null;
  zohoPoId?: string | null;
  zohoPrId?: string | null;
  notes?: string | null;
}

export interface CreateReceivingLineParams {
  receivingId?: number | null;
  zohoItemId: string;
  itemName?: string | null;
  sku?: string | null;
  quantityReceived?: number | null;
  quantityExpected?: number | null;
  qaStatus?: string | null;
  dispositionCode?: string | null;
  conditionGrade?: string | null;
  notes?: string | null;
}

// ─── receiving ────────────────────────────────────────────────────────────────

/**
 * Get receiving logs with optional filters and pagination
 */
export async function getReceivingLogs(options?: {
  weekStart?: string;
  weekEnd?: string;
  limit?: number;
  offset?: number;
}): Promise<ReceivingLog[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (options?.weekStart) { conditions.push(`received_at >= $${idx++}`); params.push(options.weekStart); }
  if (options?.weekEnd) { conditions.push(`received_at <= $${idx++}`); params.push(options.weekEnd); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT * FROM receiving ${where} ORDER BY received_at DESC NULLS LAST, id DESC LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return result.rows;
}

/**
 * Get a single receiving log by ID
 */
export async function getReceivingLogById(id: number): Promise<ReceivingLog | null> {
  const result = await pool.query('SELECT * FROM receiving WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Get a receiving log by tracking number (last-8 match)
 */
export async function getReceivingLogByTracking(tracking: string): Promise<ReceivingLog | null> {
  const last8 = tracking.replace(/\D/g, '').slice(-8);
  const result = await pool.query(
    `SELECT * FROM receiving
     WHERE RIGHT(regexp_replace(tracking_number, '\\D', '', 'g'), 8) = $1
     ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1`,
    [last8],
  );
  return result.rows[0] ?? null;
}

/**
 * Get pending unboxing items (received but not yet unboxed)
 */
export async function getPendingUnboxing(limit = 100): Promise<ReceivingLog[]> {
  const result = await pool.query(
    `SELECT r.*,
            COUNT(rl.id)::int AS line_count,
            COUNT(rl.id) FILTER (WHERE rl.qa_status = 'DONE')::int AS done_count
     FROM receiving r
     LEFT JOIN receiving_lines rl ON rl.receiving_id = r.id
     WHERE r.unboxed_at IS NULL
       AND r.qa_status != 'CANCELLED'
     GROUP BY r.id
     ORDER BY r.received_at ASC NULLS LAST
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

/**
 * Create a new receiving log
 */
export async function createReceivingLog(params: CreateReceivingLogParams): Promise<ReceivingLog> {
  const result = await pool.query(
    `INSERT INTO receiving
       (tracking_number, carrier, received_at, qa_status, disposition_code, condition_grade,
        is_return, return_platform, needs_test, assigned_tech_id, target_channel,
        zoho_po_id, zoho_pr_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      params.trackingNumber,
      params.carrier ?? null,
      normalizePSTTimestamp(params.receivedAt, { fallbackToNow: true }),
      params.qaStatus ?? 'PENDING',
      params.dispositionCode ?? 'HOLD',
      params.conditionGrade ?? 'BRAND_NEW',
      params.isReturn ?? false,
      params.returnPlatform ?? null,
      params.needsTest ?? false,
      params.assignedTechId ?? null,
      params.targetChannel ?? null,
      params.zohoPoId ?? null,
      params.zohoPrId ?? null,
      params.notes ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update a receiving log (partial update)
 */
export async function updateReceivingLog(
  id: number,
  updates: Partial<Record<string, any>>,
): Promise<ReceivingLog | null> {
  const allowed = [
    'tracking_number', 'carrier', 'received_at', 'qa_status', 'disposition_code',
    'condition_grade', 'is_return', 'return_platform', 'needs_test', 'assigned_tech_id',
    'target_channel', 'unboxed_by', 'unboxed_at', 'zoho_po_id', 'zoho_pr_id', 'notes',
  ];

  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = $${idx++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return getReceivingLogById(id);

  params.push(id);
  const result = await pool.query(
    `UPDATE receiving SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a receiving log by ID
 */
export async function deleteReceivingLog(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM receiving WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ─── receiving_lines ──────────────────────────────────────────────────────────

/**
 * Get receiving lines for a specific receiving log
 */
export async function getReceivingLines(receivingId: number): Promise<ReceivingLine[]> {
  const result = await pool.query(
    'SELECT * FROM receiving_lines WHERE receiving_id = $1 ORDER BY id ASC',
    [receivingId],
  );
  return result.rows;
}

/**
 * Get a single receiving line by ID
 */
export async function getReceivingLineById(id: number): Promise<ReceivingLine | null> {
  const result = await pool.query('SELECT * FROM receiving_lines WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Get all receiving lines with optional filters and pagination
 */
export async function getAllReceivingLines(options?: {
  search?: string;
  qaStatus?: string;
  disposition?: string;
  limit?: number;
  offset?: number;
}): Promise<ReceivingLine[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (options?.search) {
    conditions.push(`(rl.item_name ILIKE $${idx} OR rl.sku ILIKE $${idx} OR rl.zoho_item_id ILIKE $${idx})`);
    params.push(`%${options.search}%`);
    idx++;
  }
  if (options?.qaStatus) { conditions.push(`rl.qa_status = $${idx++}`); params.push(options.qaStatus); }
  if (options?.disposition) { conditions.push(`rl.disposition_code = $${idx++}`); params.push(options.disposition); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT rl.*,
            r.tracking_number,
            r.carrier
     FROM receiving_lines rl
     LEFT JOIN receiving r ON r.id = rl.receiving_id
     ${where}
     ORDER BY rl.id DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return result.rows;
}

/**
 * Create a new receiving line
 */
export async function createReceivingLine(params: CreateReceivingLineParams): Promise<ReceivingLine> {
  const result = await pool.query(
    `INSERT INTO receiving_lines
       (receiving_id, zoho_item_id, item_name, sku, quantity_received, quantity_expected,
        qa_status, disposition_code, condition_grade, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      params.receivingId ?? null,
      params.zohoItemId,
      params.itemName ?? null,
      params.sku ?? null,
      params.quantityReceived ?? null,
      params.quantityExpected ?? null,
      params.qaStatus ?? 'PENDING',
      params.dispositionCode ?? 'HOLD',
      params.conditionGrade ?? 'BRAND_NEW',
      params.notes ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update a receiving line (partial update)
 */
export async function updateReceivingLine(
  id: number,
  updates: Partial<Record<string, any>>,
): Promise<ReceivingLine | null> {
  const allowed = [
    'receiving_id', 'zoho_item_id', 'item_name', 'sku', 'quantity_received', 'quantity_expected',
    'qa_status', 'disposition_code', 'condition_grade', 'disposition_audit', 'notes',
  ];

  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = $${idx++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return getReceivingLineById(id);

  params.push(id);
  const result = await pool.query(
    `UPDATE receiving_lines SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a receiving line by ID
 */
export async function deleteReceivingLine(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM receiving_lines WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ─── receiving_photos ─────────────────────────────────────────────────────────

/**
 * Get all photos for a receiving log
 */
export async function getReceivingPhotos(receivingId: number): Promise<ReceivingPhoto[]> {
  const result = await pool.query(
    'SELECT * FROM receiving_photos WHERE receiving_id = $1 ORDER BY uploaded_at ASC',
    [receivingId],
  );
  return result.rows;
}

/**
 * Save a receiving photo
 */
export async function saveReceivingPhoto(receivingId: number, url: string): Promise<ReceivingPhoto> {
  const result = await pool.query(
    'INSERT INTO receiving_photos (receiving_id, url, uploaded_at) VALUES ($1, $2, NOW()) RETURNING *',
    [receivingId, url],
  );
  return result.rows[0];
}

/**
 * Delete a receiving photo by ID
 */
export async function deleteReceivingPhoto(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM receiving_photos WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
