import pool from '../db';

export interface TechSerialNumber {
  id: number;
  serial_number: string;
  shipping_tracking_number: string | null;
  tested_by: number | null;
  test_date_time: string | null;
  fnsku: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface TechLogWithOrder extends TechSerialNumber {
  order_id: string | null;
  product_title: string | null;
  sku: string | null;
  fnsku_title: string | null;
}

export interface CreateTechLogParams {
  serialNumber: string;
  shippingTrackingNumber?: string | null;
  testedBy?: number | null;
  testDateTime?: string | null;
  fnsku?: string | null;
  notes?: string | null;
}

// ─── tech_serial_numbers ──────────────────────────────────────────────────────

/**
 * Get tech logs with optional filters, joined with order and FBA data
 */
export async function getTechLogs(options?: {
  techId?: number;
  weekStart?: string;
  weekEnd?: string;
  limit?: number;
  offset?: number;
}): Promise<TechLogWithOrder[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (options?.techId != null) {
    conditions.push(`tsn.tested_by = $${idx++}`);
    params.push(options.techId);
  }
  if (options?.weekStart) {
    conditions.push(`tsn.test_date_time >= $${idx++}`);
    params.push(options.weekStart);
  }
  if (options?.weekEnd) {
    conditions.push(`tsn.test_date_time <= $${idx++}`);
    params.push(options.weekEnd);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 500;
  const offset = options?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
       tsn.*,
       o.order_id,
       o.product_title,
       o.sku,
       ff.product_title AS fnsku_title
     FROM tech_serial_numbers tsn
     LEFT JOIN LATERAL (
       SELECT order_id, product_title, sku
       FROM orders o
       WHERE o.shipping_tracking_number IS NOT NULL
         AND RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8) =
             RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
       ORDER BY o.id DESC LIMIT 1
     ) o ON true
     LEFT JOIN LATERAL (
       SELECT product_title
       FROM fba_fnskus ff
       WHERE ff.fnsku = tsn.fnsku
       LIMIT 1
     ) ff ON tsn.fnsku IS NOT NULL
     ${where}
     ORDER BY tsn.test_date_time DESC NULLS LAST, tsn.id DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return result.rows;
}

/**
 * Get a single tech log by ID
 */
export async function getTechLogById(id: number): Promise<TechSerialNumber | null> {
  const result = await pool.query('SELECT * FROM tech_serial_numbers WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Search tech logs
 */
export async function searchTechLogs(query: string, techId?: number): Promise<TechLogWithOrder[]> {
  const searchTerm = `%${query}%`;
  const params: any[] = [searchTerm];
  const techCondition = techId != null ? `AND tsn.tested_by = $2` : '';
  if (techId != null) params.push(techId);

  const result = await pool.query(
    `SELECT
       tsn.*,
       o.order_id,
       o.product_title,
       o.sku,
       ff.product_title AS fnsku_title
     FROM tech_serial_numbers tsn
     LEFT JOIN LATERAL (
       SELECT order_id, product_title, sku
       FROM orders o
       WHERE o.shipping_tracking_number IS NOT NULL
         AND RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8) =
             RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
       ORDER BY o.id DESC LIMIT 1
     ) o ON true
     LEFT JOIN LATERAL (
       SELECT product_title FROM fba_fnskus ff WHERE ff.fnsku = tsn.fnsku LIMIT 1
     ) ff ON tsn.fnsku IS NOT NULL
     WHERE (
       tsn.serial_number ILIKE $1
       OR tsn.shipping_tracking_number ILIKE $1
       OR tsn.fnsku ILIKE $1
     ) ${techCondition}
     ORDER BY tsn.test_date_time DESC NULLS LAST, tsn.id DESC
     LIMIT 100`,
    params,
  );
  return result.rows;
}

/**
 * Create a new tech serial number log
 */
export async function createTechLog(params: CreateTechLogParams): Promise<TechSerialNumber> {
  const result = await pool.query(
    `INSERT INTO tech_serial_numbers
       (serial_number, shipping_tracking_number, tested_by, test_date_time, fnsku, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.serialNumber,
      params.shippingTrackingNumber ?? null,
      params.testedBy ?? null,
      params.testDateTime ?? new Date().toISOString(),
      params.fnsku ?? null,
      params.notes ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update a tech log entry
 */
export async function updateTechLog(
  id: number,
  updates: Partial<{
    serialNumber: string;
    shippingTrackingNumber: string | null;
    testedBy: number | null;
    testDateTime: string | null;
    fnsku: string | null;
    notes: string | null;
  }>,
): Promise<TechSerialNumber | null> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (updates.serialNumber !== undefined) { setClauses.push(`serial_number = $${idx++}`); params.push(updates.serialNumber); }
  if (updates.shippingTrackingNumber !== undefined) { setClauses.push(`shipping_tracking_number = $${idx++}`); params.push(updates.shippingTrackingNumber); }
  if (updates.testedBy !== undefined) { setClauses.push(`tested_by = $${idx++}`); params.push(updates.testedBy); }
  if (updates.testDateTime !== undefined) { setClauses.push(`test_date_time = $${idx++}`); params.push(updates.testDateTime); }
  if (updates.fnsku !== undefined) { setClauses.push(`fnsku = $${idx++}`); params.push(updates.fnsku); }
  if (updates.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(updates.notes); }

  if (setClauses.length === 0) return getTechLogById(id);

  params.push(id);
  const result = await pool.query(
    `UPDATE tech_serial_numbers SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a tech log by ID
 */
export async function deleteTechLog(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM tech_serial_numbers WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete the most recent tech log for a given tracking number and tech ID
 */
export async function deleteLatestTechLogByTracking(
  tracking: string,
  techId?: number | null,
): Promise<{ deletedId: number; serialNumber: string } | null> {
  const last8 = tracking.replace(/\D/g, '').slice(-8);
  const techCondition = techId != null ? 'AND tested_by = $2' : '';
  const params: any[] = [last8];
  if (techId != null) params.push(techId);

  const result = await pool.query(
    `DELETE FROM tech_serial_numbers
     WHERE id = (
       SELECT id FROM tech_serial_numbers
       WHERE RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
         ${techCondition}
       ORDER BY test_date_time DESC NULLS LAST, id DESC
       LIMIT 1
     )
     RETURNING id, serial_number`,
    params,
  );
  if (!result.rows[0]) return null;
  return { deletedId: result.rows[0].id, serialNumber: result.rows[0].serial_number };
}

/**
 * Get all serial numbers for a given tracking number
 */
export async function getSerialsByTracking(tracking: string): Promise<string[]> {
  const last8 = tracking.replace(/\D/g, '').slice(-8);
  const result = await pool.query(
    `SELECT serial_number FROM tech_serial_numbers
     WHERE RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
     ORDER BY test_date_time ASC`,
    [last8],
  );
  return result.rows.map((r) => r.serial_number);
}
