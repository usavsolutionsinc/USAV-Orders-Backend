import pool from '../db';

export interface ProductManual {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  display_name: string | null;
  google_file_id: string | null;
  source_url: string | null;
  relative_path: string | null;
  folder_path: string | null;
  file_name: string | null;
  status: 'unassigned' | 'assigned' | 'archived';
  assigned_at: string | null;
  assigned_by: string | null;
  type: string | null;
  is_active: boolean;
  updated_at: string | null;
  created_at: string | null;
  sku_catalog_id: number | null;
}

export interface UpsertProductManualParams {
  itemNumber?: string | null;
  productTitle?: string | null;
  displayName?: string | null;
  googleDocIdOrUrl?: string | null;
  sourceUrl?: string | null;
  relativePath?: string | null;
  folderPath?: string | null;
  fileName?: string | null;
  status?: 'unassigned' | 'assigned' | 'archived' | null;
  assignedBy?: string | null;
  type?: string | null;
}

export interface UpdateProductManualParams {
  id: number;
  sku?: string | null;
  itemNumber?: string | null;
  productTitle?: string | null;
  displayName?: string | null;
  googleDocIdOrUrl?: string | null;
  sourceUrl?: string | null;
  relativePath?: string | null;
  folderPath?: string | null;
  fileName?: string | null;
  status?: 'unassigned' | 'assigned' | 'archived' | null;
  assignedBy?: string | null;
  type?: string | null;
  isActive?: boolean | null;
}

/**
 * Extract a Google Doc ID from a URL or return as-is if already an ID
 */
function extractGoogleDocId(urlOrId: string): string {
  const trimmed = String(urlOrId || '').trim();
  if (!trimmed) return '';
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : trimmed;
}

function normalizeManualStatus(value: unknown): 'unassigned' | 'assigned' | 'archived' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'unassigned' || raw === 'archived') return raw;
  return 'assigned';
}

/**
 * Get all active product manuals
 */
export async function getAllProductManuals(options?: {
  limit?: number;
  offset?: number;
  status?: 'unassigned' | 'assigned' | 'archived' | null;
  itemNumber?: string | null;
  relativePath?: string | null;
}): Promise<ProductManual[]> {
  const limit = Math.min(options?.limit ?? 5000, 10000);
  const offset = options?.offset ?? 0;
  const status = options?.status ? normalizeManualStatus(options.status) : null;
  const itemNumber = options?.itemNumber
    ? options.itemNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')
    : null;
  const relativePath = String(options?.relativePath || '').trim() || null;
  const result = await pool.query(
    `SELECT id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, is_active, updated_at, created_at
     FROM product_manuals
     WHERE is_active = TRUE
       AND ($3::text IS NULL OR status = $3)
       AND (
         $4::text IS NULL
         OR regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') = $4
       )
       AND ($5::text IS NULL OR relative_path = $5)
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset, status, itemNumber, relativePath],
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

export async function getProductManualByRelativePath(relativePath: string): Promise<ProductManual | null> {
  const safeRelativePath = String(relativePath || '').trim();
  if (!safeRelativePath) return null;

  const result = await pool.query(
    `SELECT *
     FROM product_manuals
     WHERE is_active = TRUE
       AND relative_path = $1
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [safeRelativePath],
  );
  return result.rows[0] ?? null;
}

/**
 * Search product manuals by SKU, item number, or title
 */
export async function searchProductManuals(
  query: string,
  limit = 20,
  status?: 'unassigned' | 'assigned' | 'archived' | null,
): Promise<ProductManual[]> {
  const normalizedStatus = status ? normalizeManualStatus(status) : null;
  const result = await pool.query(
    `SELECT id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, is_active, updated_at
     FROM product_manuals
     WHERE is_active = TRUE
       AND ($4::text IS NULL OR status = $4)
       AND (
         item_number ILIKE $1
         OR display_name ILIKE $1
         OR product_title ILIKE $1
         OR COALESCE(file_name, '') ILIKE $1
         OR COALESCE(relative_path, '') ILIKE $1
         OR COALESCE(source_url, '') ILIKE $1
         OR regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') =
            regexp_replace(UPPER(TRIM($2)), '[^A-Z0-9]', '', 'g')
       )
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT $3`,
    [`%${query}%`, query, limit, normalizedStatus],
  );
  return result.rows;
}

/**
 * Get product manuals by category (type field)
 */
export async function getProductManualsByCategory(category: string, limit = 100): Promise<ProductManual[]> {
  const result = await pool.query(
    `SELECT id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, updated_at
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
    `SELECT id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, updated_at
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
     `SELECT pm.id, pm.sku, pm.item_number, pm.product_title, pm.display_name, pm.google_file_id, pm.source_url, pm.relative_path, pm.folder_path, pm.file_name, pm.status, pm.assigned_at, pm.assigned_by, pm.type, pm.updated_at
     FROM product_manuals pm
     JOIN orders o ON (
       (o.item_number IS NOT NULL AND o.item_number != ''
        AND regexp_replace(UPPER(TRIM(COALESCE(pm.item_number, ''))), '[^A-Z0-9]', '', 'g') =
            regexp_replace(UPPER(TRIM(o.item_number)), '[^A-Z0-9]', '', 'g'))
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
  const googleDocId = extractGoogleDocId(String(params.googleDocIdOrUrl || '')) || null;
  const hasProductTitle = Object.prototype.hasOwnProperty.call(params, 'productTitle');
  const hasDisplayName = Object.prototype.hasOwnProperty.call(params, 'displayName');
  const hasGoogleDocId = Object.prototype.hasOwnProperty.call(params, 'googleDocIdOrUrl');
  const hasSourceUrl = Object.prototype.hasOwnProperty.call(params, 'sourceUrl');
  const hasFolderPath = Object.prototype.hasOwnProperty.call(params, 'folderPath');
  const hasFileName = Object.prototype.hasOwnProperty.call(params, 'fileName');
  const hasAssignedBy = Object.prototype.hasOwnProperty.call(params, 'assignedBy');
  const hasType = Object.prototype.hasOwnProperty.call(params, 'type');
  const normalizedItemNumber = params.itemNumber
    ? params.itemNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')
    : null;
  const relativePath = String(params.relativePath || '').trim() || null;
  const fileName = String(params.fileName || '').trim() || (relativePath ? relativePath.split('/').pop() || null : null);
  const sourceUrl = String(params.sourceUrl || '').trim() || null;
  const status = normalizeManualStatus(params.status);
  const folderPath = String(params.folderPath || '').trim()
    || (status === 'assigned' && normalizedItemNumber ? `assigned/${normalizedItemNumber}` : null);
  const displayName =
    String(params.displayName || '').trim()
    || String(params.productTitle || '').trim()
    || fileName
    || (normalizedItemNumber ? `${normalizedItemNumber} Manual` : null);
  const assignedAt = status === 'assigned' ? new Date().toISOString() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!normalizedItemNumber && status === 'assigned') {
      throw new Error('itemNumber is required for assigned manuals');
    }
    if (!googleDocId && !relativePath) {
      throw new Error('googleDocIdOrUrl or relativePath is required');
    }

    const existing = relativePath
      ? await client.query(
        `SELECT id
         FROM product_manuals
         WHERE is_active = TRUE
           AND relative_path = $1
         LIMIT 1`,
        [relativePath],
      )
      : await client.query(
        `SELECT id
         FROM product_manuals
         WHERE is_active = TRUE
           AND google_file_id = $1
           AND (
             ($2::text IS NULL AND item_number IS NULL)
             OR regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') = $2
           )
         LIMIT 1`,
        [googleDocId, normalizedItemNumber],
      );

    if ((existing.rowCount ?? 0) > 0) {
      const updated = await client.query(
        `UPDATE product_manuals
         SET sku = $2,
             item_number = $3,
             product_title = CASE WHEN $15 THEN $4 ELSE product_title END,
             display_name = CASE WHEN $16 THEN $5 ELSE display_name END,
             google_file_id = CASE WHEN $17 THEN $6 ELSE google_file_id END,
             source_url = CASE WHEN $18 THEN $7 ELSE source_url END,
             relative_path = $8,
             folder_path = CASE WHEN $19 THEN $9 ELSE folder_path END,
             file_name = CASE WHEN $20 THEN $10 ELSE file_name END,
             status = $11,
             assigned_at = CASE WHEN $11 = 'assigned' THEN COALESCE(assigned_at, $12::timestamptz) ELSE NULL END,
             assigned_by = CASE WHEN $21 THEN $13 ELSE assigned_by END,
             type = CASE WHEN $22 THEN $14 ELSE type END,
             is_active = TRUE,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          existing.rows[0].id,
          null,
          normalizedItemNumber,
          params.productTitle ?? null,
          displayName,
          googleDocId,
          sourceUrl,
          relativePath,
          folderPath,
          fileName,
          status,
          assignedAt,
          params.assignedBy ?? null,
          params.type ?? null,
          hasProductTitle,
          hasDisplayName,
          hasGoogleDocId,
          hasSourceUrl,
          hasFolderPath,
          hasFileName,
          hasAssignedBy,
          hasType,
        ],
      );

      await client.query('COMMIT');
      return updated.rows[0];
    }

    // Insert new active record
    const insertResult = await client.query(
      `INSERT INTO product_manuals
         (sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, TRUE, NOW())
       RETURNING *`,
      [
        null,
        normalizedItemNumber,
        params.productTitle ?? null,
        displayName,
        googleDocId,
        sourceUrl,
        relativePath,
        folderPath,
        fileName,
        status,
        assignedAt,
        params.assignedBy ?? null,
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
    `UPDATE product_manuals
     SET is_active = FALSE,
         status = CASE WHEN status = 'unassigned' THEN 'archived' ELSE status END,
         updated_at = NOW()
     WHERE id = $1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateProductManual(params: UpdateProductManualParams): Promise<ProductManual> {
  const normalizedItemNumber = params.itemNumber === undefined
    ? undefined
    : (params.itemNumber ? params.itemNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '') : null);
  const googleDocId = params.googleDocIdOrUrl === undefined
    ? undefined
    : (extractGoogleDocId(String(params.googleDocIdOrUrl || '')) || null);
  const relativePath = params.relativePath === undefined ? undefined : (String(params.relativePath || '').trim() || null);
  const fileName = params.fileName === undefined
    ? undefined
    : (String(params.fileName || '').trim() || (relativePath ? relativePath.split('/').pop() || null : null));
  const status = params.status === undefined ? undefined : normalizeManualStatus(params.status);
  const folderPath = params.folderPath === undefined
    ? undefined
    : (String(params.folderPath || '').trim() || null);

  const result = await pool.query(
    `UPDATE product_manuals
     SET sku = COALESCE($2, sku),
         item_number = COALESCE($3, item_number),
         product_title = COALESCE($4, product_title),
         display_name = COALESCE($5, display_name),
         google_file_id = CASE WHEN $6::text IS NULL AND $16 THEN NULL ELSE COALESCE($6, google_file_id) END,
         source_url = CASE WHEN $7::text IS NULL AND $17 THEN NULL ELSE COALESCE($7, source_url) END,
         relative_path = CASE WHEN $8::text IS NULL AND $18 THEN NULL ELSE COALESCE($8, relative_path) END,
         folder_path = CASE WHEN $9::text IS NULL AND $19 THEN NULL ELSE COALESCE($9, folder_path) END,
         file_name = CASE WHEN $10::text IS NULL AND $20 THEN NULL ELSE COALESCE($10, file_name) END,
         status = COALESCE($11, status),
         assigned_at = CASE
           WHEN COALESCE($11, status) = 'assigned' THEN COALESCE(assigned_at, NOW())
           WHEN COALESCE($11, status) != 'assigned' THEN NULL
           ELSE assigned_at
         END,
         assigned_by = CASE WHEN $12::text IS NULL AND $21 THEN NULL ELSE COALESCE($12, assigned_by) END,
         type = CASE WHEN $13::text IS NULL AND $22 THEN NULL ELSE COALESCE($13, type) END,
         is_active = COALESCE($14, is_active),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      params.id,
      params.sku ?? null,
      normalizedItemNumber ?? null,
      params.productTitle ?? null,
      params.displayName ?? null,
      googleDocId ?? null,
      params.sourceUrl ?? null,
      relativePath ?? null,
      folderPath ?? null,
      fileName ?? null,
      status ?? null,
      params.assignedBy ?? null,
      params.type ?? null,
      params.isActive ?? null,
      0,
      params.googleDocIdOrUrl !== undefined && !googleDocId,
      params.sourceUrl !== undefined && !params.sourceUrl,
      params.relativePath !== undefined && !relativePath,
      params.folderPath !== undefined && !folderPath,
      params.fileName !== undefined && !fileName,
      params.assignedBy !== undefined && !params.assignedBy,
      params.type !== undefined && !params.type,
    ],
  );

  if (!result.rows[0]) {
    throw new Error('Product manual not found');
  }

  return result.rows[0];
}

/**
 * Hard-delete a product manual by ID
 */
export async function deleteProductManual(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM product_manuals WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
