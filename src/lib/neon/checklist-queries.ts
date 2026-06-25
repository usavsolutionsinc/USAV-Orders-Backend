/**
 * Query layer for `checklist_templates` — the polymorphic fill-in checklist
 * table (see migration 2026-06-25_create_checklist_templates.sql).
 *
 * Tenant-safe by construction: every helper REQUIRES an `orgId` and runs through
 * the tenant client (`tenantQuery` / `withTenantTransaction`) with an explicit
 * `organization_id` predicate, mirroring the qc_check_templates helpers in
 * `sku-catalog-queries.ts`.
 */

import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export type ChecklistScopeType = 'GLOBAL' | 'CATEGORY' | 'SKU';

export interface ChecklistTemplateRow {
  id: number;
  organization_id: string;
  scope_type: ChecklistScopeType;
  scope_id: number | null;
  step_label: string;
  step_type: string;
  status: string;
  value_kind: string | null;
  value_unit: string | null;
  value_enum: string[] | null;
  pass_min: string | null;
  pass_max: string | null;
  failure_mode_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ChecklistValueConfig {
  valueKind?: string | null;
  valueUnit?: string | null;
  valueEnum?: string[] | null;
  passMin?: number | null;
  passMax?: number | null;
  failureModeId?: number | null;
}

/** Normalize a scope into a `(scope_type, scope_id)` pair. GLOBAL has no id. */
function normalizeScope(scopeType: ChecklistScopeType, scopeId?: number | null): {
  scopeType: ChecklistScopeType;
  scopeId: number | null;
} {
  if (scopeType === 'GLOBAL') return { scopeType, scopeId: null };
  return { scopeType, scopeId: scopeId ?? null };
}

/** Read a scope's checklist steps in display order. `publishedOnly` for fill views. */
export async function getChecklistTemplates(
  orgId: OrgId,
  scopeType: ChecklistScopeType,
  scopeId: number | null,
  opts?: { publishedOnly?: boolean },
): Promise<ChecklistTemplateRow[]> {
  const { scopeId: sid } = normalizeScope(scopeType, scopeId);
  const publishedOnly = opts?.publishedOnly === true;
  const sql = `SELECT * FROM checklist_templates
     WHERE organization_id = $1
       AND scope_type = $2
       AND ($3::int IS NULL AND scope_id IS NULL OR scope_id = $3)
       AND ($4::boolean IS FALSE OR status = 'published')
     ORDER BY sort_order, id`;
  const result = await tenantQuery<ChecklistTemplateRow>(orgId, sql, [orgId, scopeType, sid, publishedOnly]);
  return result.rows;
}

/** Fetch one step, org-scoped (before-state audit + cross-org 404). */
export async function getChecklistTemplateById(
  id: number,
  orgId: OrgId,
): Promise<ChecklistTemplateRow | null> {
  const r = await tenantQuery<ChecklistTemplateRow>(
    orgId,
    `SELECT * FROM checklist_templates WHERE id = $1 AND organization_id = $2`,
    [id, orgId],
  );
  return r.rows[0] ?? null;
}

export async function createChecklistTemplate(
  params: {
    scopeType: ChecklistScopeType;
    scopeId?: number | null;
    stepLabel: string;
    stepType?: string;
    sortOrder?: number;
    status?: string;
  } & ChecklistValueConfig,
  orgId: OrgId,
): Promise<ChecklistTemplateRow> {
  const { scopeType, scopeId } = normalizeScope(params.scopeType, params.scopeId);
  const status = params.status === 'draft' ? 'draft' : 'published';
  const valueEnumJson = params.valueEnum != null ? JSON.stringify(params.valueEnum) : null;
  const sql = `INSERT INTO checklist_templates
       (organization_id, scope_type, scope_id, step_label, step_type, sort_order, status,
        value_kind, value_unit, value_enum, pass_min, pass_max, failure_mode_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
     RETURNING *`;
  const values: unknown[] = [
    orgId,
    scopeType,
    scopeId,
    params.stepLabel.trim(),
    params.stepType?.trim() || 'PASS_FAIL',
    params.sortOrder ?? 0,
    status,
    params.valueKind ?? null,
    params.valueUnit?.trim() || null,
    valueEnumJson,
    params.passMin ?? null,
    params.passMax ?? null,
    params.failureModeId ?? null,
  ];
  const result = await withTenantTransaction(orgId, (client) =>
    client.query<ChecklistTemplateRow>(sql, values),
  );
  return result.rows[0];
}

export async function updateChecklistTemplate(
  id: number,
  updates: {
    stepLabel?: string;
    stepType?: string;
    sortOrder?: number;
    status?: string;
  } & ChecklistValueConfig,
  orgId: OrgId,
): Promise<ChecklistTemplateRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.stepLabel !== undefined) {
    sets.push(`step_label = $${idx++}`);
    values.push(updates.stepLabel.trim());
  }
  if (updates.stepType !== undefined) {
    sets.push(`step_type = $${idx++}`);
    values.push(updates.stepType.trim());
  }
  if (updates.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx++}`);
    values.push(updates.sortOrder);
  }
  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(updates.status === 'draft' ? 'draft' : 'published');
  }
  if (updates.valueKind !== undefined) {
    sets.push(`value_kind = $${idx++}`);
    values.push(updates.valueKind ?? null);
  }
  if (updates.valueUnit !== undefined) {
    sets.push(`value_unit = $${idx++}`);
    values.push(updates.valueUnit?.trim() || null);
  }
  if (updates.valueEnum !== undefined) {
    sets.push(`value_enum = $${idx++}::jsonb`);
    values.push(updates.valueEnum != null ? JSON.stringify(updates.valueEnum) : null);
  }
  if (updates.passMin !== undefined) {
    sets.push(`pass_min = $${idx++}`);
    values.push(updates.passMin ?? null);
  }
  if (updates.passMax !== undefined) {
    sets.push(`pass_max = $${idx++}`);
    values.push(updates.passMax ?? null);
  }
  if (updates.failureModeId !== undefined) {
    sets.push(`failure_mode_id = $${idx++}`);
    values.push(updates.failureModeId ?? null);
  }

  if (sets.length === 0) return null;
  sets.push(`updated_at = NOW()`);

  const idPlaceholder = idx++;
  values.push(id);
  const orgPlaceholder = idx++;
  values.push(orgId);

  const sql = `UPDATE checklist_templates SET ${sets.join(', ')}
     WHERE id = $${idPlaceholder} AND organization_id = $${orgPlaceholder}
     RETURNING *`;
  const result = await withTenantTransaction(orgId, (client) =>
    client.query<ChecklistTemplateRow>(sql, values),
  );
  return result.rows[0] ?? null;
}

export async function deleteChecklistTemplate(id: number, orgId: OrgId): Promise<boolean> {
  const result = await withTenantTransaction(orgId, (client) =>
    client.query(`DELETE FROM checklist_templates WHERE id = $1 AND organization_id = $2`, [id, orgId]),
  );
  return (result.rowCount || 0) > 0;
}
