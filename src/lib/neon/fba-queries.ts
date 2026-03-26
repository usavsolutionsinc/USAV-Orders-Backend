/**
 * Legacy helper module for the pre-`fba_shipments.id` model.
 * Active FBA pages now use raw SQL routes keyed by the internal plan row id.
 * Do not wire new features to this file without reconciling the schema first.
 */

import pool from '../db';

export type FbaShipmentStatus = 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
export type FbaItemStatus = 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
export type FbaScanEventType = 'PACK_VERIFIED' | 'FNSKU_SCANNED' | 'LABEL_APPLIED' | 'SHIPMENT_CLOSED';

export interface FbaShipment {
  id: number;
  shipment_id: string;
  shipment_ref: string | null;
  status: FbaShipmentStatus;
  notes: string | null;
  created_by: number | null;
  assigned_tech_id: number | null;
  assigned_packer_id: number | null;
  created_at: string | null;
  closed_at: string | null;
  total_items?: number;
  ready_items?: number;
  labeled_items?: number;
  shipped_items?: number;
  total_expected_qty?: number;
  total_actual_qty?: number;
}

export interface FbaShipmentItem {
  id: number;
  shipment_id: string;
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  expected_qty: number;
  actual_qty: number;
  status: FbaItemStatus;
  ready_by: number | null;
  verified_by: number | null;
  labeled_by: number | null;
  shipped_by: number | null;
  created_at: string | null;
}

export interface FbaScanEvent {
  id: number;
  shipment_id: string | null;
  item_id: number | null;
  fnsku: string;
  staff_id: number;
  event_type: FbaScanEventType;
  scanned_at: string | null;
  notes: string | null;
}

export interface CreateFbaShipmentParams {
  shipmentId: string;
  shipmentRef?: string | null;
  status?: FbaShipmentStatus;
  notes?: string | null;
  createdBy?: number | null;
  assignedTechId?: number | null;
  assignedPackerId?: number | null;
}

export interface CreateFbaShipmentItemParams {
  shipmentId: string;
  fnsku: string;
  productTitle?: string | null;
  asin?: string | null;
  sku?: string | null;
  expectedQty?: number;
  actualQty?: number;
  status?: FbaItemStatus;
}

// ─── fba_shipments ────────────────────────────────────────────────────────────

/**
 * Get all FBA shipments with aggregated stats
 */
export async function getFbaShipments(options?: {
  status?: string | string[];
  query?: string;
  limit?: number;
}): Promise<FbaShipment[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (options?.status) {
    const statuses = Array.isArray(options.status) ? options.status : options.status.split(',').map((s) => s.trim().toUpperCase());
    if (statuses.length > 0 && !statuses.includes('ALL')) {
      conditions.push(`fs.status = ANY($${idx++}::text[])`);
      params.push(statuses);
    }
  }
  if (options?.query) {
    conditions.push(`(fs.shipment_ref ILIKE $${idx} OR fs.notes ILIKE $${idx})`);
    params.push(`%${options.query}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(options?.limit ?? 100, 500);
  params.push(limit);

  const result = await pool.query(
    `SELECT
       fs.*,
       COUNT(fsi.id)::int                                               AS total_items,
       COUNT(fsi.id) FILTER (WHERE fsi.status IN ('READY_TO_GO','LABEL_ASSIGNED','SHIPPED'))::int AS ready_items,
       COUNT(fsi.id) FILTER (WHERE fsi.status IN ('LABEL_ASSIGNED','SHIPPED'))::int               AS labeled_items,
       COUNT(fsi.id) FILTER (WHERE fsi.status = 'SHIPPED')::int                                   AS shipped_items,
       COALESCE(SUM(fsi.expected_qty), 0)::int                          AS total_expected_qty,
       COALESCE(SUM(fsi.actual_qty), 0)::int                            AS total_actual_qty,
       creator.name  AS creator_name,
       tech.name     AS tech_name,
       packer.name   AS packer_name
     FROM fba_shipments fs
     LEFT JOIN fba_shipment_items fsi ON fsi.shipment_id = fs.shipment_id
     LEFT JOIN staff creator ON creator.id = fs.created_by
     LEFT JOIN staff tech    ON tech.id    = fs.assigned_tech_id
     LEFT JOIN staff packer  ON packer.id  = fs.assigned_packer_id
     ${where}
     GROUP BY fs.id, creator.name, tech.name, packer.name
     ORDER BY fs.created_at DESC NULLS LAST
     LIMIT $${idx}`,
    params,
  );
  return result.rows;
}

/**
 * Get a single FBA shipment by its shipment_id string
 */
export async function getFbaShipmentByRef(shipmentId: string): Promise<FbaShipment | null> {
  const result = await pool.query(
    'SELECT * FROM fba_shipments WHERE shipment_id = $1',
    [shipmentId],
  );
  return result.rows[0] ?? null;
}

/**
 * Create a new FBA shipment
 */
export async function createFbaShipment(params: CreateFbaShipmentParams): Promise<FbaShipment> {
  const result = await pool.query(
    `INSERT INTO fba_shipments
       (shipment_id, shipment_ref, status, notes, created_by, assigned_tech_id, assigned_packer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.shipmentId,
      params.shipmentRef ?? null,
      params.status ?? 'PLANNED',
      params.notes ?? null,
      params.createdBy ?? null,
      params.assignedTechId ?? null,
      params.assignedPackerId ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update a FBA shipment
 */
export async function updateFbaShipment(
  shipmentId: string,
  updates: Partial<{
    status: FbaShipmentStatus;
    shipmentRef: string | null;
    notes: string | null;
    assignedTechId: number | null;
    assignedPackerId: number | null;
    closedAt: string | null;
  }>,
): Promise<FbaShipment | null> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (updates.status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(updates.status); }
  if (updates.shipmentRef !== undefined) { setClauses.push(`shipment_ref = $${idx++}`); params.push(updates.shipmentRef); }
  if (updates.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(updates.notes); }
  if (updates.assignedTechId !== undefined) { setClauses.push(`assigned_tech_id = $${idx++}`); params.push(updates.assignedTechId); }
  if (updates.assignedPackerId !== undefined) { setClauses.push(`assigned_packer_id = $${idx++}`); params.push(updates.assignedPackerId); }
  if (updates.closedAt !== undefined) { setClauses.push(`closed_at = $${idx++}`); params.push(updates.closedAt); }

  if (setClauses.length === 0) return getFbaShipmentByRef(shipmentId);

  params.push(shipmentId);
  const result = await pool.query(
    `UPDATE fba_shipments SET ${setClauses.join(', ')} WHERE shipment_id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Close a FBA shipment (set status to SHIPPED and record closed_at)
 */
export async function closeFbaShipment(shipmentId: string): Promise<FbaShipment | null> {
  const result = await pool.query(
    `UPDATE fba_shipments SET status = 'SHIPPED', closed_at = NOW()
     WHERE shipment_id = $1 RETURNING *`,
    [shipmentId],
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a FBA shipment
 */
export async function deleteFbaShipment(shipmentId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM fba_shipments WHERE shipment_id = $1', [shipmentId]);
  return (result.rowCount ?? 0) > 0;
}

// ─── fba_shipment_items ───────────────────────────────────────────────────────

/**
 * Get all items for a FBA shipment
 */
export async function getFbaShipmentItems(shipmentId: string): Promise<FbaShipmentItem[]> {
  const result = await pool.query(
    `SELECT fsi.*,
            rb.name AS ready_by_name,
            vb.name AS verified_by_name,
            lb.name AS labeled_by_name,
            sb.name AS shipped_by_name
     FROM fba_shipment_items fsi
     LEFT JOIN staff rb ON rb.id = fsi.ready_by
     LEFT JOIN staff vb ON vb.id = fsi.verified_by
     LEFT JOIN staff lb ON lb.id = fsi.labeled_by
     LEFT JOIN staff sb ON sb.id = fsi.shipped_by
     WHERE fsi.shipment_id = $1
     ORDER BY fsi.status DESC, fsi.fnsku ASC`,
    [shipmentId],
  );
  return result.rows;
}

/**
 * Get a single FBA shipment item by ID
 */
export async function getFbaShipmentItemById(id: number): Promise<FbaShipmentItem | null> {
  const result = await pool.query('SELECT * FROM fba_shipment_items WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Upsert a FBA shipment item (insert or update on conflict)
 */
export async function upsertFbaShipmentItem(params: CreateFbaShipmentItemParams): Promise<FbaShipmentItem> {
  const result = await pool.query(
    `INSERT INTO fba_shipment_items
       (shipment_id, fnsku, product_title, asin, sku, expected_qty, actual_qty, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (shipment_id, fnsku)
     DO UPDATE SET
       product_title = COALESCE(EXCLUDED.product_title, fba_shipment_items.product_title),
       asin          = COALESCE(EXCLUDED.asin, fba_shipment_items.asin),
       sku           = COALESCE(EXCLUDED.sku, fba_shipment_items.sku),
       expected_qty  = EXCLUDED.expected_qty,
       actual_qty    = fba_shipment_items.actual_qty + EXCLUDED.actual_qty,
       status        = EXCLUDED.status
     RETURNING *`,
    [
      params.shipmentId,
      params.fnsku,
      params.productTitle ?? null,
      params.asin ?? null,
      params.sku ?? null,
      params.expectedQty ?? 0,
      params.actualQty ?? 0,
      params.status ?? 'PLANNED',
    ],
  );
  return result.rows[0];
}

/**
 * Update a FBA shipment item
 */
export async function updateFbaShipmentItem(
  id: number,
  updates: Partial<{
    status: FbaItemStatus;
    actualQty: number;
    expectedQty: number;
    readyBy: number | null;
    verifiedBy: number | null;
    labeledBy: number | null;
    shippedBy: number | null;
  }>,
): Promise<FbaShipmentItem | null> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (updates.status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(updates.status); }
  if (updates.actualQty !== undefined) { setClauses.push(`actual_qty = $${idx++}`); params.push(updates.actualQty); }
  if (updates.expectedQty !== undefined) { setClauses.push(`expected_qty = $${idx++}`); params.push(updates.expectedQty); }
  if (updates.readyBy !== undefined) { setClauses.push(`ready_by = $${idx++}`); params.push(updates.readyBy); }
  if (updates.verifiedBy !== undefined) { setClauses.push(`verified_by = $${idx++}`); params.push(updates.verifiedBy); }
  if (updates.labeledBy !== undefined) { setClauses.push(`labeled_by = $${idx++}`); params.push(updates.labeledBy); }
  if (updates.shippedBy !== undefined) { setClauses.push(`shipped_by = $${idx++}`); params.push(updates.shippedBy); }

  if (setClauses.length === 0) return getFbaShipmentItemById(id);

  params.push(id);
  const result = await pool.query(
    `UPDATE fba_shipment_items SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a FBA shipment item by ID
 */
export async function deleteFbaShipmentItem(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM fba_shipment_items WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ─── fba_scan_events ─────────────────────────────────────────────────────────

/**
 * Record a FBA scan event
 */
export async function recordFbaScanEvent(params: {
  shipmentId?: string | null;
  itemId?: number | null;
  fnsku: string;
  staffId: number;
  eventType: FbaScanEventType;
  notes?: string | null;
}): Promise<FbaScanEvent> {
  const result = await pool.query(
    `INSERT INTO fba_scan_events
       (shipment_id, item_id, fnsku, staff_id, event_type, scanned_at, notes)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)
     RETURNING *`,
    [
      params.shipmentId ?? null,
      params.itemId ?? null,
      params.fnsku,
      params.staffId,
      params.eventType,
      params.notes ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Get scan events for a shipment
 */
export async function getFbaScanEvents(shipmentId: string): Promise<FbaScanEvent[]> {
  const result = await pool.query(
    `SELECT fse.*, s.name AS staff_name
     FROM fba_scan_events fse
     LEFT JOIN staff s ON s.id = fse.staff_id
     WHERE fse.shipment_id = $1
     ORDER BY fse.scanned_at DESC`,
    [shipmentId],
  );
  return result.rows;
}
