import pool from '../db';

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

export async function getReasonCodeById(id: number): Promise<ReasonCodeRow | null> {
  const r = await pool.query<ReasonCodeRow>(
    `SELECT ${COLS} FROM reason_codes WHERE id = $1 LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function createReasonCode(input: {
  code: string;
  label: string;
  category: string;
  direction?: 'in' | 'out' | 'either';
  requiresNote?: boolean;
  requiresPhoto?: boolean;
  sortOrder?: number;
}): Promise<ReasonCodeRow> {
  const r = await pool.query<ReasonCodeRow>(
    `INSERT INTO reason_codes
       (code, label, category, direction, requires_note, requires_photo, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     RETURNING ${COLS}`,
    [
      input.code.trim(),
      input.label.trim(),
      input.category.trim(),
      input.direction ?? 'either',
      input.requiresNote ?? false,
      input.requiresPhoto ?? false,
      input.sortOrder ?? 0,
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
): Promise<ReasonCodeRow | null> {
  const r = await pool.query<ReasonCodeRow>(
    `UPDATE reason_codes SET
        label          = COALESCE($2, label),
        category       = COALESCE($3, category),
        direction      = COALESCE($4, direction),
        requires_note  = COALESCE($5, requires_note),
        requires_photo = COALESCE($6, requires_photo),
        sort_order     = COALESCE($7, sort_order),
        is_active      = COALESCE($8, is_active)
      WHERE id = $1
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
    ],
  );
  return r.rows[0] ?? null;
}

/**
 * Soft-delete (is_active = false). Reason codes are referenced by FK from
 * inventory_events / bin adjustments, so we never hard-delete. Returns the
 * now-inactive row, or null if it didn't exist or was already inactive.
 */
export async function softDeleteReasonCode(id: number): Promise<ReasonCodeRow | null> {
  const r = await pool.query<ReasonCodeRow>(
    `UPDATE reason_codes
        SET is_active = false
      WHERE id = $1 AND is_active = true
      RETURNING ${COLS}`,
    [id],
  );
  return r.rows[0] ?? null;
}
