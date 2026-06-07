import pool from '@/lib/db';

/**
 * Failure-mode taxonomy (failure_modes) + per-unit failure tags
 * (unit_failure_tags). See docs/condition-grading-repair-qc-plan.md §4.3/§4.4
 * and 2026-06-07_failure_modes.sql.
 */

export interface FailureModeRow {
  id: number;
  code: string;
  label: string;
  category: string;
  severity: string;
  is_repairable: boolean;
  typical_cost_cents: number | null;
  caps_grade_at: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface UnitFailureTagRow {
  id: number;
  serial_unit_id: number;
  failure_mode_id: number;
  detected_at: string;
  detected_by_staff_id: number | null;
  source: string;
  resolution_status: string;
  inventory_event_id: number | null;
  notes: string | null;
  created_at: string;
  // Joined from failure_modes for display.
  code?: string;
  label?: string;
  category?: string;
  severity?: string;
  caps_grade_at?: string | null;
  detected_by_name?: string | null;
}

// ─── Taxonomy CRUD ──────────────────────────────────────────────────────────

export async function listFailureModes(opts?: { activeOnly?: boolean }): Promise<FailureModeRow[]> {
  const activeOnly = opts?.activeOnly === true;
  const r = await pool.query(
    `SELECT * FROM failure_modes
      WHERE ($1::boolean IS FALSE OR active = true)
      ORDER BY sort_order, label`,
    [activeOnly],
  );
  return r.rows;
}

export async function createFailureMode(params: {
  code: string;
  label: string;
  category?: string;
  severity?: string;
  isRepairable?: boolean;
  typicalCostCents?: number | null;
  capsGradeAt?: string | null;
  sortOrder?: number;
}): Promise<FailureModeRow> {
  const r = await pool.query(
    `INSERT INTO failure_modes
       (code, label, category, severity, is_repairable, typical_cost_cents, caps_grade_at, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7::condition_grade_enum, $8)
     RETURNING *`,
    [
      params.code.trim().toUpperCase(),
      params.label.trim(),
      params.category ?? 'hardware',
      params.severity ?? 'major',
      params.isRepairable ?? true,
      params.typicalCostCents ?? null,
      params.capsGradeAt ?? null,
      params.sortOrder ?? 0,
    ],
  );
  return r.rows[0];
}

export async function updateFailureMode(
  id: number,
  updates: {
    label?: string;
    category?: string;
    severity?: string;
    isRepairable?: boolean;
    typicalCostCents?: number | null;
    capsGradeAt?: string | null;
    sortOrder?: number;
    active?: boolean;
  },
): Promise<FailureModeRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown, cast = '') => {
    sets.push(`${col} = $${idx++}${cast}`);
    values.push(val);
  };
  if (updates.label !== undefined) push('label', updates.label.trim());
  if (updates.category !== undefined) push('category', updates.category);
  if (updates.severity !== undefined) push('severity', updates.severity);
  if (updates.isRepairable !== undefined) push('is_repairable', updates.isRepairable);
  if (updates.typicalCostCents !== undefined) push('typical_cost_cents', updates.typicalCostCents);
  if (updates.capsGradeAt !== undefined) push('caps_grade_at', updates.capsGradeAt, '::condition_grade_enum');
  if (updates.sortOrder !== undefined) push('sort_order', updates.sortOrder);
  if (updates.active !== undefined) push('active', updates.active);
  if (sets.length === 0) return null;
  values.push(id);
  const r = await pool.query(
    `UPDATE failure_modes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return r.rows[0] ?? null;
}

/** Soft delete — deactivate so historical tags keep resolving their mode. */
export async function deactivateFailureMode(id: number): Promise<boolean> {
  const r = await pool.query(
    `UPDATE failure_modes SET active = false WHERE id = $1`,
    [id],
  );
  return (r.rowCount || 0) > 0;
}

// ─── Per-unit tags ──────────────────────────────────────────────────────────

export async function listUnitFailureTags(serialUnitId: number): Promise<UnitFailureTagRow[]> {
  const r = await pool.query(
    `SELECT t.*, fm.code, fm.label, fm.category, fm.severity, fm.caps_grade_at,
            s.name AS detected_by_name
       FROM unit_failure_tags t
       JOIN failure_modes fm ON fm.id = t.failure_mode_id
  LEFT JOIN staff s ON s.id = t.detected_by_staff_id
      WHERE t.serial_unit_id = $1
   ORDER BY (t.resolution_status = 'open') DESC, t.detected_at DESC`,
    [serialUnitId],
  );
  return r.rows;
}

/**
 * Open a failure tag. Idempotent: the partial unique index keeps at most one
 * OPEN tag per (unit, mode), so a re-tag returns the existing open row.
 */
export async function tagUnitFailure(params: {
  serialUnitId: number;
  failureModeId: number;
  detectedByStaffId?: number | null;
  source?: string;
  notes?: string | null;
}): Promise<UnitFailureTagRow> {
  const inserted = await pool.query(
    `INSERT INTO unit_failure_tags
       (serial_unit_id, failure_mode_id, detected_by_staff_id, source, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (serial_unit_id, failure_mode_id) WHERE resolution_status = 'open'
       DO NOTHING
     RETURNING *`,
    [
      params.serialUnitId,
      params.failureModeId,
      params.detectedByStaffId ?? null,
      params.source ?? 'manual',
      params.notes?.trim() || null,
    ],
  );
  if (inserted.rows.length > 0) return inserted.rows[0];
  // Already an open tag — return it.
  const existing = await pool.query(
    `SELECT * FROM unit_failure_tags
      WHERE serial_unit_id = $1 AND failure_mode_id = $2 AND resolution_status = 'open'
      LIMIT 1`,
    [params.serialUnitId, params.failureModeId],
  );
  return existing.rows[0];
}

export async function resolveUnitFailureTag(
  tagId: number,
  status: 'resolved' | 'scrapped' | 'wontfix' | 'open',
  notes?: string | null,
): Promise<UnitFailureTagRow | null> {
  const r = await pool.query(
    `UPDATE unit_failure_tags
        SET resolution_status = $2,
            notes = COALESCE($3, notes)
      WHERE id = $1
      RETURNING *`,
    [tagId, status, notes?.trim() || null],
  );
  return r.rows[0] ?? null;
}
