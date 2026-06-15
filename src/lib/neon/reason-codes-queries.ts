import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface ReasonCodeRow {
  id: number;
  code: string;
  label: string;
  category: string;
  direction: 'in' | 'out' | 'either';
  requires_note: boolean;
  requires_photo: boolean;
  sort_order: number;
  is_active: boolean;
}

const COLS = `id, code, label, category, direction, requires_note, requires_photo, sort_order, is_active`;

export async function getReasonCodeById(id: number, orgId: OrgId): Promise<ReasonCodeRow | null> {
  const r = await tenantQuery<ReasonCodeRow>(
    orgId,
    `SELECT ${COLS} FROM reason_codes WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId],
  );
  return r.rows[0] ?? null;
}

export async function createReasonCode(
  input: {
    code: string;
    label: string;
    category: string;
    direction?: 'in' | 'out' | 'either';
    requiresNote?: boolean;
    requiresPhoto?: boolean;
    sortOrder?: number;
  },
  orgId: OrgId,
): Promise<ReasonCodeRow> {
  const r = await tenantQuery<ReasonCodeRow>(
    orgId,
    `INSERT INTO reason_codes
       (code, label, category, direction, requires_note, requires_photo, sort_order, is_active, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
     RETURNING ${COLS}`,
    [
      input.code.trim(),
      input.label.trim(),
      input.category.trim(),
      input.direction ?? 'either',
      input.requiresNote ?? false,
      input.requiresPhoto ?? false,
      input.sortOrder ?? 0,
      orgId,
    ],
  );
  return r.rows[0];
}

/**
 * Partial update. Only the provided fields change; `undefined` leaves the
 * column untouched via COALESCE. Returns the updated row, or null if not found.
 */
export async function updateReasonCode(
  id: number,
  patch: {
    label?: string;
    category?: string;
    direction?: 'in' | 'out' | 'either';
    requiresNote?: boolean;
    requiresPhoto?: boolean;
    sortOrder?: number;
    isActive?: boolean;
  },
  orgId: OrgId,
): Promise<ReasonCodeRow | null> {
  const r = await tenantQuery<ReasonCodeRow>(
    orgId,
    `UPDATE reason_codes SET
        label          = COALESCE($2, label),
        category       = COALESCE($3, category),
        direction      = COALESCE($4, direction),
        requires_note  = COALESCE($5, requires_note),
        requires_photo = COALESCE($6, requires_photo),
        sort_order     = COALESCE($7, sort_order),
        is_active      = COALESCE($8, is_active)
      WHERE id = $1 AND organization_id = $9
      RETURNING ${COLS}`,
    [
      id,
      patch.label?.trim() ?? null,
      patch.category?.trim() ?? null,
      patch.direction ?? null,
      patch.requiresNote ?? null,
      patch.requiresPhoto ?? null,
      patch.sortOrder ?? null,
      patch.isActive ?? null,
      orgId,
    ],
  );
  return r.rows[0] ?? null;
}

/**
 * Soft-delete (is_active = false). Reason codes are referenced by FK from
 * inventory_events / bin adjustments, so we never hard-delete. Returns the
 * now-inactive row, or null if it didn't exist or was already inactive.
 */
export async function softDeleteReasonCode(id: number, orgId: OrgId): Promise<ReasonCodeRow | null> {
  const r = await tenantQuery<ReasonCodeRow>(
    orgId,
    `UPDATE reason_codes
        SET is_active = false
      WHERE id = $1 AND organization_id = $2 AND is_active = true
      RETURNING ${COLS}`,
    [id, orgId],
  );
  return r.rows[0] ?? null;
}
