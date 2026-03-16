import pool from '@/lib/db';

export const FAVORITE_WORKSPACE_KEYS = ['repair', 'sku-stock'] as const;

export type FavoriteWorkspaceKey = typeof FAVORITE_WORKSPACE_KEYS[number];

export interface FavoriteSkuRecord {
  id: number;
  ecwidProductId: string | null;
  sku: string;
  skuNormalized: string;
  label: string;
  productTitle: string | null;
  issueTemplate: string | null;
  defaultPrice: string | null;
  notes: string | null;
  workspaceKey: FavoriteWorkspaceKey;
  sortOrder: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdByStaffId: number | null;
  updatedByStaffId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFavoriteSkuInput {
  workspaceKey: FavoriteWorkspaceKey;
  ecwidProductId?: string | null;
  sku: string;
  label: string;
  productTitle?: string | null;
  issueTemplate?: string | null;
  defaultPrice?: string | null;
  notes?: string | null;
  sortOrder?: number | null;
  isActive?: boolean;
  staffId?: number | null;
}

export interface UpdateFavoriteSkuInput {
  id: number;
  workspaceKey: FavoriteWorkspaceKey;
  ecwidProductId?: string | null;
  sku?: string;
  label?: string;
  productTitle?: string | null;
  issueTemplate?: string | null;
  defaultPrice?: string | null;
  notes?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  staffId?: number | null;
}

function assertWorkspaceKey(value: string): asserts value is FavoriteWorkspaceKey {
  if (!FAVORITE_WORKSPACE_KEYS.includes(value as FavoriteWorkspaceKey)) {
    throw new Error(`Unsupported workspace: ${value}`);
  }
}

function normalizeSku(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function mapFavoriteRow(row: any): FavoriteSkuRecord {
  return {
    id: Number(row.id),
    ecwidProductId: row.ecwid_product_id ? String(row.ecwid_product_id) : null,
    sku: String(row.sku || ''),
    skuNormalized: String(row.sku_normalized || ''),
    label: String(row.label || ''),
    productTitle: row.product_title ?? null,
    issueTemplate: row.issue_template ?? null,
    defaultPrice: row.default_price ?? null,
    notes: row.notes ?? null,
    workspaceKey: row.workspace_key,
    sortOrder: Number(row.sort_order || 0),
    isActive: Boolean(row.is_active),
    metadata: (row.metadata && typeof row.metadata === 'object') ? row.metadata : {},
    createdByStaffId: row.created_by_staff_id == null ? null : Number(row.created_by_staff_id),
    updatedByStaffId: row.updated_by_staff_id == null ? null : Number(row.updated_by_staff_id),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
}

export async function listFavoriteSkus(workspaceKey: FavoriteWorkspaceKey, includeInactive = false): Promise<FavoriteSkuRecord[]> {
  assertWorkspaceKey(workspaceKey);
  const result = await pool.query(
    `
      SELECT
        f.id,
        f.ecwid_product_id,
        f.sku,
        f.sku_normalized,
        f.label,
        f.product_title,
        f.issue_template,
        f.default_price,
        f.notes,
        f.metadata,
        f.created_by_staff_id,
        f.updated_by_staff_id,
        f.created_at,
        f.updated_at,
        w.workspace_key,
        w.sort_order,
        w.is_active
      FROM favorite_skus f
      INNER JOIN favorite_sku_workspaces w
        ON w.favorite_id = f.id
      WHERE w.workspace_key = $1
        AND ($2::boolean = true OR w.is_active = true)
      ORDER BY w.sort_order ASC, f.label ASC, f.sku ASC
    `,
    [workspaceKey, includeInactive],
  );

  return result.rows.map(mapFavoriteRow);
}

export async function createFavoriteSku(input: CreateFavoriteSkuInput): Promise<FavoriteSkuRecord> {
  assertWorkspaceKey(input.workspaceKey);
  const sku = String(input.sku || '').trim();
  const label = String(input.label || '').trim();
  const skuNormalized = normalizeSku(sku);

  if (!sku || !skuNormalized) throw new Error('SKU is required');
  if (!label) throw new Error('Label is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const favoriteResult = await client.query(
      `
        INSERT INTO favorite_skus (
          ecwid_product_id,
          sku,
          sku_normalized,
          label,
          product_title,
          issue_template,
          default_price,
          notes,
          created_by_staff_id,
          updated_by_staff_id,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NOW())
        ON CONFLICT (sku_normalized)
        DO UPDATE SET
          ecwid_product_id = COALESCE(NULLIF(EXCLUDED.ecwid_product_id, ''), favorite_skus.ecwid_product_id),
          sku = EXCLUDED.sku,
          label = CASE WHEN EXCLUDED.label <> '' THEN EXCLUDED.label ELSE favorite_skus.label END,
          product_title = COALESCE(NULLIF(EXCLUDED.product_title, ''), favorite_skus.product_title),
          issue_template = COALESCE(NULLIF(EXCLUDED.issue_template, ''), favorite_skus.issue_template),
          default_price = COALESCE(NULLIF(EXCLUDED.default_price, ''), favorite_skus.default_price),
          notes = COALESCE(NULLIF(EXCLUDED.notes, ''), favorite_skus.notes),
          updated_by_staff_id = EXCLUDED.updated_by_staff_id,
          updated_at = NOW()
        RETURNING id
      `,
      [
        input.ecwidProductId?.trim() || null,
        sku,
        skuNormalized,
        label,
        input.productTitle?.trim() || null,
        input.issueTemplate?.trim() || null,
        input.defaultPrice?.trim() || null,
        input.notes?.trim() || null,
        input.staffId ?? null,
      ],
    );

    const favoriteId = Number(favoriteResult.rows[0]?.id);
    await client.query(
      `
        INSERT INTO favorite_sku_workspaces (
          favorite_id,
          workspace_key,
          sort_order,
          is_active,
          updated_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (favorite_id, workspace_key)
        DO UPDATE SET
          sort_order = EXCLUDED.sort_order,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
      `,
      [
        favoriteId,
        input.workspaceKey,
        input.sortOrder ?? 100,
        input.isActive ?? true,
      ],
    );

    const recordResult = await client.query(
      `
        SELECT
          f.id,
          f.ecwid_product_id,
          f.sku,
          f.sku_normalized,
          f.label,
          f.product_title,
          f.issue_template,
          f.default_price,
          f.notes,
          f.metadata,
          f.created_by_staff_id,
          f.updated_by_staff_id,
          f.created_at,
          f.updated_at,
          w.workspace_key,
          w.sort_order,
          w.is_active
        FROM favorite_skus f
        INNER JOIN favorite_sku_workspaces w
          ON w.favorite_id = f.id
        WHERE f.id = $1
          AND w.workspace_key = $2
      `,
      [favoriteId, input.workspaceKey],
    );

    await client.query('COMMIT');
    return mapFavoriteRow(recordResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateFavoriteSku(input: UpdateFavoriteSkuInput): Promise<FavoriteSkuRecord | null> {
  assertWorkspaceKey(input.workspaceKey);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `SELECT id, ecwid_product_id, sku, label, product_title, issue_template, default_price, notes
       FROM favorite_skus
       WHERE id = $1`,
      [input.id],
    );
    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const current = currentResult.rows[0];
    const nextSku = input.sku != null ? String(input.sku).trim() : String(current.sku || '');
    const nextLabel = input.label != null ? String(input.label).trim() : String(current.label || '');
    const nextSkuNormalized = normalizeSku(nextSku);

    if (!nextSku || !nextSkuNormalized) throw new Error('SKU is required');
    if (!nextLabel) throw new Error('Label is required');

    await client.query(
      `
        UPDATE favorite_skus
        SET
          ecwid_product_id = $2,
          sku = $3,
          sku_normalized = $4,
          label = $5,
          product_title = $6,
          issue_template = $7,
          default_price = $8,
          notes = $9,
          updated_by_staff_id = $10,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        input.id,
        input.ecwidProductId !== undefined ? input.ecwidProductId?.trim() || null : current.ecwid_product_id ?? null,
        nextSku,
        nextSkuNormalized,
        nextLabel,
        input.productTitle !== undefined ? input.productTitle?.trim() || null : current.product_title ?? null,
        input.issueTemplate !== undefined ? input.issueTemplate?.trim() || null : current.issue_template ?? null,
        input.defaultPrice !== undefined ? input.defaultPrice?.trim() || null : current.default_price ?? null,
        input.notes !== undefined ? input.notes?.trim() || null : current.notes ?? null,
        input.staffId ?? null,
      ],
    );

    if (input.sortOrder !== undefined || input.isActive !== undefined) {
      await client.query(
        `
          UPDATE favorite_sku_workspaces
          SET
            sort_order = COALESCE($3, sort_order),
            is_active = COALESCE($4, is_active),
            updated_at = NOW()
          WHERE favorite_id = $1
            AND workspace_key = $2
        `,
        [input.id, input.workspaceKey, input.sortOrder ?? null, input.isActive ?? null],
      );
    }

    const recordResult = await client.query(
      `
        SELECT
          f.id,
          f.ecwid_product_id,
          f.sku,
          f.sku_normalized,
          f.label,
          f.product_title,
          f.issue_template,
          f.default_price,
          f.notes,
          f.metadata,
          f.created_by_staff_id,
          f.updated_by_staff_id,
          f.created_at,
          f.updated_at,
          w.workspace_key,
          w.sort_order,
          w.is_active
        FROM favorite_skus f
        INNER JOIN favorite_sku_workspaces w
          ON w.favorite_id = f.id
        WHERE f.id = $1
          AND w.workspace_key = $2
      `,
      [input.id, input.workspaceKey],
    );

    await client.query('COMMIT');
    return recordResult.rows[0] ? mapFavoriteRow(recordResult.rows[0]) : null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteFavoriteSku(id: number, workspaceKey: FavoriteWorkspaceKey): Promise<boolean> {
  assertWorkspaceKey(workspaceKey);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleteResult = await client.query(
      `DELETE FROM favorite_sku_workspaces
       WHERE favorite_id = $1
         AND workspace_key = $2`,
      [id, workspaceKey],
    );

    if ((deleteResult.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const remainingResult = await client.query(
      `SELECT 1 FROM favorite_sku_workspaces WHERE favorite_id = $1 LIMIT 1`,
      [id],
    );
    if (remainingResult.rows.length === 0) {
      await client.query(`DELETE FROM favorite_skus WHERE id = $1`, [id]);
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
