import 'server-only';

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Server-backed saved views for the Master Operations Journey. Personal presets
 * owned by a staff member within an org (optionally shared org-wide). Every query
 * is org-scoped; mutations are additionally ownership-scoped (`staff_id = $me`) so
 * a user can only edit/delete their own views. See
 * `2026-06-24_operations_saved_views.sql`.
 */

export interface OperationsSavedView {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  is_shared: boolean;
  sort_order: number;
  staff_id: number;
  created_at: string;
  updated_at: string;
}

const COLS = `id, name, filters, is_shared, sort_order, staff_id, created_at, updated_at`;

/** Views visible to a staffer: their own + any org-shared views. */
export async function listOperationsSavedViews(
  orgId: OrgId,
  staffId: number,
): Promise<OperationsSavedView[]> {
  const { rows } = await tenantQuery<OperationsSavedView>(
    orgId,
    `SELECT ${COLS}
       FROM operations_saved_views
      WHERE organization_id = $1 AND (staff_id = $2 OR is_shared = true)
      ORDER BY sort_order ASC, name ASC`,
    [orgId, staffId],
  );
  return rows;
}

export async function getOperationsSavedView(
  id: number,
  orgId: OrgId,
): Promise<OperationsSavedView | null> {
  const { rows } = await tenantQuery<OperationsSavedView>(
    orgId,
    `SELECT ${COLS} FROM operations_saved_views WHERE id = $1 AND organization_id = $2`,
    [id, orgId],
  );
  return rows[0] ?? null;
}

export async function createOperationsSavedView(
  input: { name: string; filters: Record<string, unknown>; isShared?: boolean; sortOrder?: number },
  orgId: OrgId,
  staffId: number,
): Promise<OperationsSavedView> {
  const { rows } = await tenantQuery<OperationsSavedView>(
    orgId,
    `INSERT INTO operations_saved_views (organization_id, staff_id, name, filters, is_shared, sort_order)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING ${COLS}`,
    [orgId, staffId, input.name, JSON.stringify(input.filters ?? {}), input.isShared ?? false, input.sortOrder ?? 0],
  );
  return rows[0];
}

/** Ownership-scoped update — only the creating staffer can edit. */
export async function updateOperationsSavedView(
  id: number,
  orgId: OrgId,
  staffId: number,
  patch: {
    name?: string;
    filters?: Record<string, unknown>;
    isShared?: boolean;
    sortOrder?: number;
  },
): Promise<OperationsSavedView | null> {
  const { rows } = await tenantQuery<OperationsSavedView>(
    orgId,
    `UPDATE operations_saved_views
        SET name      = COALESCE($4, name),
            filters   = COALESCE($5::jsonb, filters),
            is_shared = COALESCE($6, is_shared),
            sort_order = COALESCE($7, sort_order),
            updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND staff_id = $3
      RETURNING ${COLS}`,
    [
      id,
      orgId,
      staffId,
      patch.name ?? null,
      patch.filters ? JSON.stringify(patch.filters) : null,
      patch.isShared ?? null,
      patch.sortOrder ?? null,
    ],
  );
  return rows[0] ?? null;
}

/** Ownership-scoped hard delete (these are disposable presets, no audit trail to keep). */
export async function deleteOperationsSavedView(
  id: number,
  orgId: OrgId,
  staffId: number,
): Promise<boolean> {
  const { rowCount } = await tenantQuery(
    orgId,
    `DELETE FROM operations_saved_views WHERE id = $1 AND organization_id = $2 AND staff_id = $3`,
    [id, orgId, staffId],
  );
  return (rowCount ?? 0) > 0;
}
