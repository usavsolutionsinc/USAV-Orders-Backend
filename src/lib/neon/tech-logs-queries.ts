import pool from '../db';
import { resolveShipmentId } from '../shipping/resolve';

export interface TechSerialNumber {
  id: number;
  serial_number: string;
  /** Resolved from shipment FK or scan_ref for display */
  shipping_tracking_number: string | null;
  shipment_id: number | null;
  scan_ref: string | null;
  tested_by: number | null;
  created_at: string | null;
  updated_at: string | null;
  fnsku: string | null;
  notes: string | null;
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
    conditions.push(`tsn.created_at >= $${idx++}`);
    params.push(options.weekStart);
  }
  if (options?.weekEnd) {
    conditions.push(`tsn.created_at <= $${idx++}`);
    params.push(options.weekEnd);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 500;
  const offset = options?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
       tsn.id, tsn.serial_number, tsn.serial_type, tsn.created_at, tsn.updated_at,
       tsn.tested_by, tsn.fnsku, tsn.notes,
       tsn.shipment_id, tsn.scan_ref,
       COALESCE(stn.tracking_number_raw, tsn.scan_ref) AS shipping_tracking_number,
       o.order_id,
       o.product_title,
       o.sku,
       ff.product_title AS fnsku_title
     FROM tech_serial_numbers tsn
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
     LEFT JOIN orders o ON o.shipment_id = tsn.shipment_id AND tsn.shipment_id IS NOT NULL
     LEFT JOIN LATERAL (
       SELECT product_title
       FROM fba_fnskus ff
       WHERE ff.fnsku = tsn.fnsku
       LIMIT 1
     ) ff ON tsn.fnsku IS NOT NULL
     ${where}
     ORDER BY tsn.created_at DESC NULLS LAST, tsn.id DESC
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
       tsn.id, tsn.serial_number, tsn.serial_type, tsn.created_at, tsn.updated_at,
       tsn.tested_by, tsn.fnsku, tsn.notes,
       tsn.shipment_id, tsn.scan_ref,
       COALESCE(stn.tracking_number_raw, tsn.scan_ref) AS shipping_tracking_number,
       o.order_id,
       o.product_title,
       o.sku,
       ff.product_title AS fnsku_title
     FROM tech_serial_numbers tsn
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
     LEFT JOIN orders o ON o.shipment_id = tsn.shipment_id AND tsn.shipment_id IS NOT NULL
     LEFT JOIN LATERAL (
       SELECT product_title FROM fba_fnskus ff WHERE ff.fnsku = tsn.fnsku LIMIT 1
     ) ff ON tsn.fnsku IS NOT NULL
     WHERE (
       tsn.serial_number ILIKE $1
       OR stn.tracking_number_raw ILIKE $1
       OR tsn.scan_ref ILIKE $1
       OR tsn.fnsku ILIKE $1
     ) ${techCondition}
     ORDER BY tsn.created_at DESC NULLS LAST, tsn.id DESC
     LIMIT 100`,
    params,
  );
  return result.rows;
}

/**
 * Create a new tech serial number log
 */
export async function createTechLog(params: CreateTechLogParams): Promise<TechSerialNumber> {
  const raw = params.shippingTrackingNumber?.trim() ?? '';
  const { shipmentId, scanRef } = raw ? await resolveShipmentId(raw) : { shipmentId: null, scanRef: null };
  const result = await pool.query(
    `INSERT INTO tech_serial_numbers
       (serial_number, shipment_id, scan_ref, tested_by, fnsku, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.serialNumber,
      shipmentId,
      scanRef,
      params.testedBy ?? null,
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
    fnsku: string | null;
    notes: string | null;
  }>,
): Promise<TechSerialNumber | null> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (updates.serialNumber !== undefined) { setClauses.push(`serial_number = $${idx++}`); params.push(updates.serialNumber); }
  if (updates.shippingTrackingNumber !== undefined) {
    // Legacy field — resolve to shipment_id/scan_ref
    const raw = updates.shippingTrackingNumber?.trim() ?? '';
    const resolved = raw ? await resolveShipmentId(raw) : { shipmentId: null, scanRef: null };
    setClauses.push(`shipment_id = $${idx++}`); params.push(resolved.shipmentId);
    setClauses.push(`scan_ref = $${idx++}`); params.push(resolved.scanRef);
  }
  if (updates.testedBy !== undefined) { setClauses.push(`tested_by = $${idx++}`); params.push(updates.testedBy); }
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
       SELECT tsn.id FROM tech_serial_numbers tsn
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
       WHERE RIGHT(
               COALESCE(stn.tracking_number_normalized,
                        regexp_replace(UPPER(COALESCE(tsn.scan_ref, '')), '[^A-Z0-9]', '', 'g')),
               8) = $1
         ${techCondition}
       ORDER BY tsn.created_at DESC NULLS LAST, tsn.id DESC
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
    `SELECT tsn.serial_number
     FROM tech_serial_numbers tsn
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
     WHERE RIGHT(
             COALESCE(stn.tracking_number_normalized,
                      regexp_replace(UPPER(COALESCE(tsn.scan_ref, '')), '[^A-Z0-9]', '', 'g')),
             8) = $1
     ORDER BY tsn.created_at ASC`,
    [last8],
  );
  return result.rows.map((r) => r.serial_number);
}
