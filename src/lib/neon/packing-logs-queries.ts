import pool from '../db';

export interface PackingLog {
  id: number;
  shipping_tracking_number: string;
  packed_by: number | null;
  pack_date_time: string | null;
  packer_photos_url: any;
  tracking_type: string | null;
  sku: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface PackingPhoto {
  id: number;
  packing_log_id: number | null;
  url: string;
  uploaded_at: string | null;
}

export interface CreatePackingLogParams {
  shippingTrackingNumber: string;
  packedBy?: number | null;
  packDateTime?: string | null;
  packerPhotosUrl?: any;
  trackingType?: string | null;
  sku?: string | null;
  notes?: string | null;
}

// ─── packer_logs ─────────────────────────────────────────────────────────────

/**
 * Get packing logs with optional filters
 */
export async function getPackingLogs(options?: {
  packerId?: number;
  trackingNumber?: string;
  limit?: number;
  offset?: number;
}): Promise<PackingLog[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (options?.packerId != null) {
    conditions.push(`packed_by = $${idx++}`);
    params.push(options.packerId);
  }
  if (options?.trackingNumber) {
    conditions.push(
      `RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $${idx++}`,
    );
    params.push(options.trackingNumber.replace(/\D/g, '').slice(-8));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 500;
  const offset = options?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT * FROM packer_logs ${where} ORDER BY pack_date_time DESC NULLS LAST, id DESC LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return result.rows;
}

/**
 * Get a single packing log by ID
 */
export async function getPackingLogById(id: number): Promise<PackingLog | null> {
  const result = await pool.query('SELECT * FROM packer_logs WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Get packing log by tracking number (last-8 match)
 */
export async function getPackingLogByTracking(tracking: string): Promise<PackingLog | null> {
  const last8 = tracking.replace(/\D/g, '').slice(-8);
  const result = await pool.query(
    `SELECT * FROM packer_logs
     WHERE RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $1
     ORDER BY pack_date_time DESC NULLS LAST, id DESC LIMIT 1`,
    [last8],
  );
  return result.rows[0] ?? null;
}

/**
 * Create a new packing log
 */
export async function createPackingLog(params: CreatePackingLogParams): Promise<PackingLog> {
  const result = await pool.query(
    `INSERT INTO packer_logs
       (shipping_tracking_number, packed_by, pack_date_time, packer_photos_url, tracking_type, sku, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.shippingTrackingNumber,
      params.packedBy ?? null,
      params.packDateTime ?? null,
      params.packerPhotosUrl ?? null,
      params.trackingType ?? null,
      params.sku ?? null,
      params.notes ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update a packing log
 */
export async function updatePackingLog(
  id: number,
  updates: Partial<{
    packedBy: number | null;
    packDateTime: string | null;
    packerPhotosUrl: any;
    trackingType: string | null;
    notes: string | null;
  }>,
): Promise<PackingLog | null> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (updates.packedBy !== undefined) { setClauses.push(`packed_by = $${idx++}`); params.push(updates.packedBy); }
  if (updates.packDateTime !== undefined) { setClauses.push(`pack_date_time = $${idx++}`); params.push(updates.packDateTime); }
  if (updates.packerPhotosUrl !== undefined) { setClauses.push(`packer_photos_url = $${idx++}`); params.push(updates.packerPhotosUrl); }
  if (updates.trackingType !== undefined) { setClauses.push(`tracking_type = $${idx++}`); params.push(updates.trackingType); }
  if (updates.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(updates.notes); }

  if (setClauses.length === 0) return getPackingLogById(id);

  params.push(id);
  const result = await pool.query(
    `UPDATE packer_logs SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a packing log by ID
 */
export async function deletePackingLog(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM packer_logs WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ─── photos ───────────────────────────────────────────────────────────────────

/**
 * Get all photos for a packing log
 */
export async function getPhotosByPackingLogId(packingLogId: number): Promise<PackingPhoto[]> {
  const result = await pool.query(
    'SELECT * FROM photos WHERE packing_log_id = $1 ORDER BY uploaded_at ASC',
    [packingLogId],
  );
  return result.rows;
}

/**
 * Save a photo URL linked to a packing log
 */
export async function savePackingPhoto(packingLogId: number, url: string): Promise<PackingPhoto> {
  const result = await pool.query(
    'INSERT INTO photos (packing_log_id, url, uploaded_at) VALUES ($1, $2, NOW()) RETURNING *',
    [packingLogId, url],
  );
  return result.rows[0];
}

/**
 * Delete a photo by ID
 */
export async function deletePhoto(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM photos WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
