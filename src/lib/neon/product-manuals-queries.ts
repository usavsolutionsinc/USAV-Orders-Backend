import pool from '../db';

export interface ProductManual {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  google_file_id: string | null;
  type: string | null;
  is_active: boolean;
  updated_at: string | null;
  created_at: string | null;
}

export interface UpsertProductManualParams {
  sku?: string | null;
  itemNumber?: string | null;
  productTitle?: string | null;
  googleDocIdOrUrl: string;
  type?: string | null;
}

/**
 * Extract a Google Doc ID from a URL or return as-is if already an ID
 */
function extractGoogleDocId(urlOrId: string): string {
  const match = urlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
}

/**
 * Get all active product manuals
 */
export async function getAllProductManuals(options?: { limit?: number; offset?: number }): Promise<ProductManual[]> {
  const limit = Math.min(options?.limit ?? 5000, 10000);
  const offset = options?.offset ?? 0;
  const result = await pool.query(
    `SELECT id, sku, item_number, product_title, google_file_id, type, is_active, updated_at, created_at
     FROM product_manuals
     WHERE is_active = TRUE
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

/**
 * Get a product manual by ID
 */
export async function getProductManualById(id: number): Promise<ProductManual | null> {
  const result = await pool.query('SELECT * FROM product_manuals WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Search product manuals by SKU, item number, or title
 */
export async function searchProductManuals(query: string, limit = 20): Promise<ProductManual[]> {
  const result = await pool.query(
    `SELECT id, sku, item_number, product_title, google_file_id, type, is_active, updated_at
     FROM product_manuals
     WHERE is_active = TRUE
       AND (
         sku ILIKE $1
         OR item_number ILIKE $1
         OR product_title ILIKE $1
         OR regexp_replace(UPPER(TRIM(COALESCE(sku, ''))), '^0+', '') =
            regexp_replace(UPPER(TRIM($2)), '^0+', '')
       )
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT $3`,
    [`%${query}%`, query, limit],
  );
  return result.rows;
}

/**
 * Get product manuals by category (type field)
 */
export async function getProductManualsByCategory(category: string, limit = 100): Promise<ProductManual[]> {
  const result = await pool.query(
    `SELECT id, sku, item_number, product_title, google_file_id, type, updated_at
     FROM product_manuals
     WHERE is_active = TRUE AND type ILIKE $1
     ORDER BY product_title ASC
     LIMIT $2`,
    [`%${category}%`, limit],
  );
  return result.rows;
}

/**
 * Get the most recently updated active product manuals
 */
export async function getRecentProductManuals(limit = 10): Promise<ProductManual[]> {
  const result = await pool.query(
    `SELECT id, sku, item_number, product_title, google_file_id, type, updated_at
     FROM product_manuals
     WHERE is_active = TRUE
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

/**
 * Resolve a product manual by order ID (looks up the order's product, then searches manuals)
 */
export async function resolveManualByOrderId(orderId: string): Promise<ProductManual | null> {
  const result = await pool.query(
     `SELECT pm.id, pm.sku, pm.item_number, pm.product_title, pm.google_file_id, pm.type, pm.updated_at
     FROM product_manuals pm
     JOIN orders o ON (
       (o.item_number IS NOT NULL AND o.item_number != ''
        AND regexp_replace(UPPER(TRIM(COALESCE(pm.item_number, ''))), '^0+', '') =
            regexp_replace(UPPER(TRIM(o.item_number)), '^0+', ''))
       OR
       (o.sku IS NOT NULL AND o.sku != ''
        AND regexp_replace(UPPER(TRIM(COALESCE(pm.sku, ''))), '^0+', '') =
            regexp_replace(UPPER(TRIM(o.sku)), '^0+', ''))
     )
     WHERE o.order_id = $1
       AND pm.is_active = TRUE
     ORDER BY pm.updated_at DESC NULLS LAST
     LIMIT 1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

/**
 * Upsert a product manual (deactivates existing matches, then inserts new active record)
 */
export async function upsertProductManual(params: UpsertProductManualParams): Promise<ProductManual> {
  const googleDocId = extractGoogleDocId(params.googleDocIdOrUrl);
  const normalizedSku = params.sku
    ? params.sku.trim().replace(/^0+/, '').toUpperCase()
    : null;
  const normalizedItemNumber = params.itemNumber
    ? params.itemNumber.trim().replace(/^0+/, '').toUpperCase()
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deactivate any existing active manual for the same SKU or item_number
    if (normalizedSku || normalizedItemNumber) {
      const deactivateConditions: string[] = [];
      const deactivateParams: any[] = [];
      let idx = 1;

      if (normalizedSku) {
        deactivateConditions.push(
          `regexp_replace(UPPER(TRIM(COALESCE(sku, ''))), '^0+', '') = $${idx++}`,
        );
        deactivateParams.push(normalizedSku);
      }
      if (normalizedItemNumber) {
        deactivateConditions.push(
          `regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '^0+', '') = $${idx++}`,
        );
        deactivateParams.push(normalizedItemNumber);
      }

      await client.query(
        `UPDATE product_manuals SET is_active = FALSE
         WHERE is_active = TRUE AND (${deactivateConditions.join(' OR ')})`,
        deactivateParams,
      );
    }

    // Insert new active record
    const insertResult = await client.query(
      `INSERT INTO product_manuals
         (sku, item_number, product_title, google_file_id, type, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
       RETURNING *`,
      [
        params.sku ?? null,
        params.itemNumber ?? null,
        params.productTitle ?? null,
        googleDocId,
        params.type ?? null,
      ],
    );

    await client.query('COMMIT');
    return insertResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deactivate (soft-delete) a product manual
 */
export async function deactivateProductManual(id: number): Promise<boolean> {
  const result = await pool.query(
    'UPDATE product_manuals SET is_active = FALSE WHERE id = $1',
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Hard-delete a product manual by ID
 */
export async function deleteProductManual(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM product_manuals WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
