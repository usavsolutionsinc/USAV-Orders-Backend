import pool from '../db';

export interface SkuStock {
  id: number;
  sku: string;
  product_title: string | null;
  stock: number;
}

export interface SkuRecord {
  id: number;
  static_sku: string | null;
  serial_number: string | null;
  shipping_tracking_number: string | null;
  notes: string | null;
  location: string | null;
  created_at: string | null;
  updated_at: string | null;
  product_title?: string | null;
}

// ─── sku_stock ────────────────────────────────────────────────────────────────

/**
 * Get all sku_stock rows with optional search
 */
export async function getAllSkuStock(options?: {
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<SkuStock[]> {
  const limit = Math.min(options?.limit ?? 250, 1000);
  const offset = options?.offset ?? 0;

  if (options?.query) {
    const q = options.query.trim();
    const fuzzy = `%${q.replace(/\s+/g, '%')}%`;
    const normalized = `%${q.replace(/[^a-zA-Z0-9]/g, '')}%`;
    const result = await pool.query(
      `SELECT id, sku, product_title, stock
       FROM sku_stock
       WHERE sku ILIKE $1 OR product_title ILIKE $1
          OR product_title ILIKE $2
          OR regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g') ILIKE $3
       ORDER BY stock DESC NULLS LAST, product_title, sku, id
       LIMIT $4 OFFSET $5`,
      [`%${q}%`, fuzzy, normalized, limit, offset],
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT id, sku, product_title, stock
     FROM sku_stock
     ORDER BY stock DESC NULLS LAST, product_title, sku, id
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

/**
 * Get a single sku_stock row by ID
 */
export async function getSkuStockById(id: number): Promise<SkuStock | null> {
  const result = await pool.query('SELECT * FROM sku_stock WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Get a single sku_stock row by SKU value
 */
export async function getSkuStockBySku(sku: string): Promise<SkuStock | null> {
  const result = await pool.query('SELECT * FROM sku_stock WHERE sku = $1 LIMIT 1', [sku]);
  return result.rows[0] ?? null;
}

/**
 * Upsert sku_stock (insert or update stock quantity)
 */
export async function upsertSkuStock(
  sku: string,
  productTitle: string | null,
  stockDelta: number,
): Promise<SkuStock> {
  const result = await pool.query(
    `INSERT INTO sku_stock (sku, product_title, stock)
     VALUES ($1, $2, $3)
     ON CONFLICT (sku)
     DO UPDATE SET
       stock         = sku_stock.stock + $3,
       product_title = COALESCE(EXCLUDED.product_title, sku_stock.product_title)
     RETURNING *`,
    [sku, productTitle, stockDelta],
  );
  return result.rows[0];
}

/**
 * Set absolute stock value for a SKU
 */
export async function setSkuStock(sku: string, productTitle: string | null, stock: number): Promise<SkuStock> {
  const result = await pool.query(
    `INSERT INTO sku_stock (sku, product_title, stock)
     VALUES ($1, $2, $3)
     ON CONFLICT (sku)
     DO UPDATE SET
       stock         = EXCLUDED.stock,
       product_title = COALESCE(EXCLUDED.product_title, sku_stock.product_title)
     RETURNING *`,
    [sku, productTitle, stock],
  );
  return result.rows[0];
}

/**
 * Update the location of a SKU (stored in sku_stock or a separate field if available)
 */
export async function updateSkuLocation(sku: string, location: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE sku_stock SET location = $1 WHERE sku = $2`,
    [location, sku],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a sku_stock row
 */
export async function deleteSkuStock(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM sku_stock WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ─── sku (inventory log) ──────────────────────────────────────────────────────

/**
 * Get all sku inventory records
 */
export async function getAllSkuRecords(options?: {
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<SkuRecord[]> {
  const limit = Math.min(options?.limit ?? 250, 1000);
  const offset = options?.offset ?? 0;

  if (options?.query) {
    const q = options.query.trim();
    const fuzzy = `%${q.replace(/\s+/g, '%')}%`;
    const normalized = `%${q.replace(/[^a-zA-Z0-9]/g, '')}%`;
    const result = await pool.query(
      `SELECT id, static_sku, serial_number, shipping_tracking_number, notes, location, created_at, updated_at
       FROM sku
       WHERE static_sku ILIKE $1 OR serial_number ILIKE $1 OR shipping_tracking_number ILIKE $1
          OR static_sku ILIKE $2
          OR regexp_replace(static_sku, '[^a-zA-Z0-9]', '', 'g') ILIKE $3
       ORDER BY id DESC
       LIMIT $4 OFFSET $5`,
      [`%${q}%`, fuzzy, normalized, limit, offset],
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT id, static_sku, serial_number, shipping_tracking_number, notes, location, created_at, updated_at
     FROM sku ORDER BY id DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

/**
 * Get a sku record by ID
 */
export async function getSkuRecordById(id: number): Promise<SkuRecord | null> {
  const result = await pool.query('SELECT * FROM sku WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Create a new sku record
 */
export async function createSkuRecord(data: {
  staticSku: string;
  serialNumber?: string | null;
  shippingTrackingNumber?: string | null;
  notes?: string | null;
  location?: string | null;
}): Promise<SkuRecord> {
  const result = await pool.query(
    `INSERT INTO sku (static_sku, serial_number, shipping_tracking_number, notes, location)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.staticSku, data.serialNumber ?? null, data.shippingTrackingNumber ?? null, data.notes ?? null, data.location ?? null],
  );
  return result.rows[0];
}

/**
 * Update a sku record
 */
export async function updateSkuRecord(
  id: number,
  data: Partial<{ staticSku: string; serialNumber: string | null; shippingTrackingNumber: string | null; notes: string | null; location: string | null }>,
): Promise<SkuRecord | null> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: any[] = [];
  let idx = 1;

  if (data.staticSku !== undefined) { setClauses.push(`static_sku = $${idx++}`); params.push(data.staticSku); }
  if (data.serialNumber !== undefined) { setClauses.push(`serial_number = $${idx++}`); params.push(data.serialNumber); }
  if (data.shippingTrackingNumber !== undefined) { setClauses.push(`shipping_tracking_number = $${idx++}`); params.push(data.shippingTrackingNumber); }
  if (data.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(data.notes); }
  if (data.location !== undefined) { setClauses.push(`location = $${idx++}`); params.push(data.location); }

  params.push(id);
  const result = await pool.query(
    `UPDATE sku SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a sku record
 */
export async function deleteSkuRecord(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM sku WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
