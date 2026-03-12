import pool from '../db';
import { resolveShipmentId } from '../shipping/resolve';

export interface PackingLog {
  id: number;
  shipping_tracking_number: string;
  packed_by: number | null;
  created_at: string | null;
  updated_at: string | null;
  tracking_type: string | null;
  sku: string | null;
  notes: string | null;
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
    const last8 = options.trackingNumber.replace(/\D/g, '').slice(-8);
    conditions.push(
      `RIGHT(COALESCE(stn.tracking_number_normalized, regexp_replace(UPPER(COALESCE(pl.scan_ref,'')), '[^A-Z0-9]', '', 'g')), 8) = $${idx++}`,
    );
    params.push(last8);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 500;
  const offset = options?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT pl.id, pl.packed_by, pl.created_at, pl.updated_at, pl.tracking_type,
            pl.shipment_id, pl.scan_ref,
            COALESCE(stn.tracking_number_raw, pl.scan_ref) AS shipping_tracking_number
     FROM packer_logs pl
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
     ${where}
     ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC
     LIMIT $${idx++} OFFSET $${idx}`,
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
    `SELECT pl.id, pl.packed_by, pl.created_at, pl.updated_at, pl.tracking_type,
            pl.shipment_id, pl.scan_ref,
            COALESCE(stn.tracking_number_raw, pl.scan_ref) AS shipping_tracking_number
     FROM packer_logs pl
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
     WHERE RIGHT(COALESCE(stn.tracking_number_normalized,
                          regexp_replace(UPPER(COALESCE(pl.scan_ref,'')), '[^A-Z0-9]', '', 'g')), 8) = $1
     ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC LIMIT 1`,
    [last8],
  );
  return result.rows[0] ?? null;
}

/**
 * Create a new packing log
 */
export async function createPackingLog(params: CreatePackingLogParams): Promise<PackingLog> {
  const raw = params.shippingTrackingNumber?.trim() ?? '';
  const { shipmentId, scanRef } = raw ? await resolveShipmentId(raw) : { shipmentId: null, scanRef: null };
  const result = await pool.query(
    `INSERT INTO packer_logs
       (shipment_id, scan_ref, packed_by, tracking_type, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      shipmentId,
      scanRef,
      params.packedBy ?? null,
      params.trackingType ?? null,
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
    trackingType: string | null;
    notes: string | null;
  }>,
): Promise<PackingLog | null> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (updates.packedBy !== undefined) { setClauses.push(`packed_by = $${idx++}`); params.push(updates.packedBy); }
  if (updates.trackingType !== undefined) { setClauses.push(`tracking_type = $${idx++}`); params.push(updates.trackingType); }
  if (updates.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(updates.notes); }
  setClauses.push(`updated_at = NOW()`);

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
