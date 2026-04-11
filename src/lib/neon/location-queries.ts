import pool from '../db';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Location {
  id: number;
  name: string;
  room: string | null;
  description: string | null;
  barcode: string | null;
  is_active: boolean;
  sort_order: number;
  row_label: string | null;
  col_label: string | null;
  bin_type: string | null;
  capacity: number | null;
  parent_id: number | null;
}

export interface BinContent {
  id: number;
  location_id: number;
  sku: string;
  qty: number;
  min_qty: number | null;
  max_qty: number | null;
  last_counted: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  location_name?: string;
  room?: string;
  row_label?: string;
  col_label?: string;
  barcode?: string;
  product_title?: string;
}

export interface LocationTransfer {
  id: number;
  entity_type: string;
  entity_id: number;
  sku: string;
  from_location: string | null;
  to_location: string;
  staff_id: number | null;
  notes: string | null;
  created_at: string;
}

// ─── Locations CRUD ─────────────────────────────────────────────────────────

export async function getActiveLocations(): Promise<Location[]> {
  const result = await pool.query(
    `SELECT id, name, room, description, barcode, is_active, sort_order,
            row_label, col_label, bin_type, capacity, parent_id
     FROM locations
     WHERE is_active = true
     ORDER BY room, sort_order, row_label, col_label, name`,
  );
  return result.rows;
}

/** Get only room-level parents (no row/col) for the room picker. */
export async function getRooms(): Promise<Location[]> {
  const result = await pool.query(
    `SELECT id, name, room, description, barcode, is_active, sort_order,
            row_label, col_label, bin_type, capacity, parent_id
     FROM locations
     WHERE is_active = true AND row_label IS NULL AND col_label IS NULL
     ORDER BY sort_order, name`,
  );
  return result.rows;
}

/** Get bins (with row/col) under a specific room. */
export async function getBinsByRoom(room: string): Promise<Location[]> {
  const result = await pool.query(
    `SELECT id, name, room, description, barcode, is_active, sort_order,
            row_label, col_label, bin_type, capacity, parent_id
     FROM locations
     WHERE is_active = true AND room = $1 AND row_label IS NOT NULL
     ORDER BY row_label, col_label`,
    [room.trim()],
  );
  return result.rows;
}

/** Get distinct rows for a room (for cascading picker). */
export async function getRowsForRoom(room: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT row_label FROM locations
     WHERE is_active = true AND room = $1 AND row_label IS NOT NULL
     ORDER BY row_label`,
    [room.trim()],
  );
  return result.rows.map((r: any) => r.row_label);
}

/** Get distinct cols for a room+row (for cascading picker). */
export async function getColsForRoomRow(room: string, row: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT col_label FROM locations
     WHERE is_active = true AND room = $1 AND row_label = $2 AND col_label IS NOT NULL
     ORDER BY col_label`,
    [room.trim(), row.trim()],
  );
  return result.rows.map((r: any) => r.col_label);
}

export async function getLocationByBarcode(barcode: string): Promise<Location | null> {
  const result = await pool.query(
    `SELECT * FROM locations WHERE barcode = $1 AND is_active = true LIMIT 1`,
    [barcode.trim()],
  );
  return result.rows[0] ?? null;
}

export async function createLocation(data: {
  name: string;
  room?: string | null;
  description?: string | null;
  barcode?: string | null;
  sortOrder?: number;
  rowLabel?: string | null;
  colLabel?: string | null;
  binType?: string | null;
  capacity?: number | null;
  parentId?: number | null;
}): Promise<Location> {
  // Auto-generate barcode if not provided and we have room+row+col
  let barcode = data.barcode?.trim() || null;
  if (!barcode && data.room && data.rowLabel && data.colLabel) {
    const roomCode = data.room.trim().replace(/\s+/g, '').replace(/zone/i, 'Z');
    barcode = `${roomCode}-${data.rowLabel.trim()}-${data.colLabel.trim().padStart(2, '0')}`;
  }

  const result = await pool.query(
    `INSERT INTO locations (name, room, description, barcode, sort_order, row_label, col_label, bin_type, capacity, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.name.trim(),
      data.room?.trim() || null,
      data.description?.trim() || null,
      barcode,
      data.sortOrder ?? 0,
      data.rowLabel?.trim() || null,
      data.colLabel?.trim() || null,
      data.binType?.trim() || null,
      data.capacity ?? null,
      data.parentId ?? null,
    ],
  );
  return result.rows[0];
}

export async function updateLocation(
  id: number,
  data: Partial<{ name: string; room: string | null; description: string | null; barcode: string | null; isActive: boolean; sortOrder: number }>,
): Promise<Location | null> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name.trim()); }
  if (data.room !== undefined) { sets.push(`room = $${idx++}`); params.push(data.room?.trim() || null); }
  if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description?.trim() || null); }
  if (data.barcode !== undefined) { sets.push(`barcode = $${idx++}`); params.push(data.barcode?.trim() || null); }
  if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }
  if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(data.sortOrder); }

  params.push(id);
  const result = await pool.query(
    `UPDATE locations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

// ─── Location Transfers ─────────────────────────────────────────────────────

export async function logLocationTransfer(data: {
  entityType: string;
  entityId: number;
  sku: string;
  fromLocation: string | null;
  toLocation: string;
  staffId?: number | null;
  notes?: string | null;
}): Promise<LocationTransfer> {
  const result = await pool.query(
    `INSERT INTO location_transfers (entity_type, entity_id, sku, from_location, to_location, staff_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [data.entityType, data.entityId, data.sku, data.fromLocation, data.toLocation, data.staffId || null, data.notes?.trim() || null],
  );
  return result.rows[0];
}

export async function getTransfersForSku(sku: string, limit = 25): Promise<LocationTransfer[]> {
  const result = await pool.query(
    `SELECT * FROM location_transfers
     WHERE sku = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sku.trim(), limit],
  );
  return result.rows;
}

// ─── Bin Contents ───────────────────────────────────────────────────────────

/** Get all SKUs stored in a specific bin (by location_id). */
export async function getBinContents(locationId: number): Promise<BinContent[]> {
  const result = await pool.query(
    `SELECT bc.*, l.name AS location_name, l.room, l.row_label, l.col_label, l.barcode,
            ss.product_title
     FROM bin_contents bc
     JOIN locations l ON l.id = bc.location_id
     LEFT JOIN sku_stock ss ON ss.sku = bc.sku
     WHERE bc.location_id = $1
     ORDER BY bc.sku`,
    [locationId],
  );
  return result.rows;
}

/** Get all bin locations for a specific SKU (where is this product stored?). */
export async function getBinLocationsBySku(sku: string): Promise<BinContent[]> {
  const result = await pool.query(
    `SELECT bc.*, l.name AS location_name, l.room, l.row_label, l.col_label, l.barcode,
            ss.product_title
     FROM bin_contents bc
     JOIN locations l ON l.id = bc.location_id
     LEFT JOIN sku_stock ss ON ss.sku = bc.sku
     WHERE bc.sku = $1 AND bc.qty > 0
     ORDER BY l.room, l.row_label, l.col_label`,
    [sku.trim()],
  );
  return result.rows;
}

/** Get bin contents by scanning a bin barcode. */
export async function getBinContentsByBarcode(barcode: string): Promise<{
  location: Location;
  contents: BinContent[];
} | null> {
  const loc = await getLocationByBarcode(barcode);
  if (!loc) return null;
  const contents = await getBinContents(loc.id);
  return { location: loc, contents };
}

/** Add or update SKU quantity in a bin. */
export async function upsertBinContent(data: {
  locationId: number;
  sku: string;
  qty: number;
  minQty?: number | null;
  maxQty?: number | null;
}): Promise<BinContent> {
  const result = await pool.query(
    `INSERT INTO bin_contents (location_id, sku, qty, min_qty, max_qty)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (location_id, sku)
     DO UPDATE SET
       qty = EXCLUDED.qty,
       min_qty = COALESCE(EXCLUDED.min_qty, bin_contents.min_qty),
       max_qty = COALESCE(EXCLUDED.max_qty, bin_contents.max_qty),
       updated_at = NOW()
     RETURNING *`,
    [data.locationId, data.sku.trim(), data.qty, data.minQty ?? null, data.maxQty ?? null],
  );
  return result.rows[0];
}

/**
 * Adjust bin quantity by delta (positive = put, negative = take).
 * Also adjusts sku_stock in the same transaction for consistency.
 */
export async function adjustBinQty(data: {
  locationId: number;
  sku: string;
  delta: number;
  staffId?: number | null;
  reason?: string;
}): Promise<{ binContent: BinContent; newStockQty: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Adjust bin qty (floor at 0)
    const binResult = await client.query(
      `INSERT INTO bin_contents (location_id, sku, qty)
       VALUES ($1, $2, GREATEST(0, $3))
       ON CONFLICT (location_id, sku)
       DO UPDATE SET
         qty = GREATEST(0, bin_contents.qty + $3),
         updated_at = NOW()
       RETURNING *`,
      [data.locationId, data.sku.trim(), data.delta],
    );

    // 2. Adjust sku_stock aggregate
    const stockResult = await client.query(
      `INSERT INTO sku_stock (sku, stock)
       VALUES ($1, GREATEST(0, $2))
       ON CONFLICT (sku)
       DO UPDATE SET stock = GREATEST(0, sku_stock.stock + $2)
       RETURNING stock`,
      [data.sku.trim(), data.delta],
    );

    // 3. Log to stock ledger
    await client.query(
      `INSERT INTO sku_stock_ledger (sku, delta, reason, staff_id)
       VALUES ($1, $2, $3, $4)`,
      [data.sku.trim(), data.delta, data.reason || 'BIN_ADJUST', data.staffId || null],
    ).catch(() => {}); // best-effort

    await client.query('COMMIT');

    return {
      binContent: binResult.rows[0],
      newStockQty: Number(stockResult.rows[0]?.stock) || 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Mark a bin as physically counted (cycle count). */
export async function markBinCounted(locationId: number, sku: string): Promise<void> {
  await pool.query(
    `UPDATE bin_contents SET last_counted = NOW() WHERE location_id = $1 AND sku = $2`,
    [locationId, sku.trim()],
  );
}

/** Get bins that are below their min_qty threshold (low stock alerts). */
export async function getLowStockBins(): Promise<BinContent[]> {
  const result = await pool.query(
    `SELECT bc.*, l.name AS location_name, l.room, l.row_label, l.col_label, l.barcode,
            ss.product_title
     FROM bin_contents bc
     JOIN locations l ON l.id = bc.location_id
     LEFT JOIN sku_stock ss ON ss.sku = bc.sku
     WHERE bc.min_qty IS NOT NULL AND bc.qty <= bc.min_qty
     ORDER BY bc.qty ASC, l.room, l.row_label, l.col_label`,
  );
  return result.rows;
}
