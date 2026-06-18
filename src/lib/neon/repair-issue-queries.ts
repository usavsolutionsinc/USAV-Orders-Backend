import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface RepairIssueTemplate {
  id: number;
  favorite_sku_id: number | null;
  label: string;
  category: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
}

const COLS = `id, favorite_sku_id, label, category, sort_order, active, created_at`;

/**
 * Fetch issue templates: global (favorite_sku_id IS NULL) + SKU-specific when a favoriteSkuId is provided.
 */
export async function getIssuesForFavorite(
  favoriteSkuId: number | null | undefined,
  orgId: OrgId,
): Promise<RepairIssueTemplate[]> {
  if (favoriteSkuId) {
    const r = await tenantQuery<RepairIssueTemplate>(
      orgId,
      `SELECT ${COLS}
         FROM repair_issue_templates
         WHERE organization_id = $1 AND (favorite_sku_id = $2 OR favorite_sku_id IS NULL) AND active = true
         ORDER BY sort_order, id`,
      [orgId, favoriteSkuId],
    );
    return r.rows;
  }

  const r = await tenantQuery<RepairIssueTemplate>(
    orgId,
    `SELECT ${COLS}
       FROM repair_issue_templates
       WHERE organization_id = $1 AND favorite_sku_id IS NULL AND active = true
       ORDER BY sort_order, id`,
    [orgId],
  );
  return r.rows;
}

export async function createIssueTemplate(
  input: {
    favoriteSkuId?: number | null;
    label: string;
    category?: string | null;
    sortOrder?: number;
  },
  orgId: OrgId,
): Promise<RepairIssueTemplate> {
  const r = await tenantQuery<RepairIssueTemplate>(
    orgId,
    `INSERT INTO repair_issue_templates (favorite_sku_id, label, category, sort_order, organization_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLS}`,
    [input.favoriteSkuId ?? null, input.label.trim(), input.category?.trim() || null, input.sortOrder ?? 0, orgId],
  );
  return r.rows[0];
}

export async function updateIssueTemplate(
  id: number,
  updates: Partial<Pick<RepairIssueTemplate, 'label' | 'category' | 'sort_order' | 'active'>>,
  orgId: OrgId,
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

  const idParam = idx++;
  const orgParam = idx;
  values.push(id, orgId);

  const r = await tenantQuery<RepairIssueTemplate>(
    orgId,
    `UPDATE repair_issue_templates SET ${sets.join(', ')}
       WHERE id = $${idParam} AND organization_id = $${orgParam}
       RETURNING ${COLS}`,
    values,
  );
  return r.rows[0] ?? null;
}

export async function deleteIssueTemplate(id: number, orgId: OrgId): Promise<boolean> {
  const r = await tenantQuery(
    orgId,
    'DELETE FROM repair_issue_templates WHERE id = $1 AND organization_id = $2',
    [id, orgId],
  );
  return (r.rowCount ?? 0) > 0;
}
