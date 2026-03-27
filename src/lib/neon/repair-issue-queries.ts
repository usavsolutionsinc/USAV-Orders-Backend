import pool from '../db';

export interface RepairIssueTemplate {
  id: number;
  favorite_sku_id: number | null;
  label: string;
  category: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
}

/**
 * Fetch issue templates: global (favorite_sku_id IS NULL) + SKU-specific when a favoriteSkuId is provided.
 */
export async function getIssuesForFavorite(favoriteSkuId?: number | null): Promise<RepairIssueTemplate[]> {
  const client = await pool.connect();
  try {
    if (favoriteSkuId) {
      const { rows } = await client.query<RepairIssueTemplate>(
        `SELECT id, favorite_sku_id, label, category, sort_order, active, created_at
         FROM repair_issue_templates
         WHERE (favorite_sku_id = $1 OR favorite_sku_id IS NULL) AND active = true
         ORDER BY sort_order, id`,
        [favoriteSkuId],
      );
      return rows;
    }

    const { rows } = await client.query<RepairIssueTemplate>(
      `SELECT id, favorite_sku_id, label, category, sort_order, active, created_at
       FROM repair_issue_templates
       WHERE favorite_sku_id IS NULL AND active = true
       ORDER BY sort_order, id`,
    );
    return rows;
  } finally {
    client.release();
  }
}

export async function createIssueTemplate(input: {
  favoriteSkuId?: number | null;
  label: string;
  category?: string | null;
  sortOrder?: number;
}): Promise<RepairIssueTemplate> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<RepairIssueTemplate>(
      `INSERT INTO repair_issue_templates (favorite_sku_id, label, category, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, favorite_sku_id, label, category, sort_order, active, created_at`,
      [input.favoriteSkuId ?? null, input.label.trim(), input.category?.trim() || null, input.sortOrder ?? 0],
    );
    return rows[0];
  } finally {
    client.release();
  }
}

export async function updateIssueTemplate(
  id: number,
  updates: Partial<Pick<RepairIssueTemplate, 'label' | 'category' | 'sort_order' | 'active'>>,
): Promise<RepairIssueTemplate | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.label !== undefined) {
    sets.push(`label = $${idx++}`);
    values.push(updates.label.trim());
  }
  if (updates.category !== undefined) {
    sets.push(`category = $${idx++}`);
    values.push(updates.category?.trim() || null);
  }
  if (updates.sort_order !== undefined) {
    sets.push(`sort_order = $${idx++}`);
    values.push(updates.sort_order);
  }
  if (updates.active !== undefined) {
    sets.push(`active = $${idx++}`);
    values.push(updates.active);
  }

  if (sets.length === 0) return null;

  values.push(id);

  const client = await pool.connect();
  try {
    const { rows } = await client.query<RepairIssueTemplate>(
      `UPDATE repair_issue_templates SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, favorite_sku_id, label, category, sort_order, active, created_at`,
      values,
    );
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function deleteIssueTemplate(id: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    const { rowCount } = await client.query('DELETE FROM repair_issue_templates WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}
