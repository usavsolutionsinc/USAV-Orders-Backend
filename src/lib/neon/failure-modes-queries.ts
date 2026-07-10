import pool from '@/lib/db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Failure-mode taxonomy (failure_modes) + per-unit failure tags
 * (unit_failure_tags). See docs/condition-grading-repair-qc-plan.md §4.3/§4.4
 * and 2026-06-07_failure_modes.sql.
 *
 * Tenancy (additive, backward-compatible): every SQL-touching export takes an
 * OPTIONAL trailing `orgId`. When present, the query runs through the tenant
 * pool (GUC-scoped) so RLS can bite under app_tenant; when omitted, behavior is
 * byte-identical to before (raw `pool`).
 *
 * Table notes (docs/tenancy/org-id-coverage.generated.md):
 *   - `failure_modes`     → NO organization_id column, NO org-bearing parent
 *                           (reference-decide). GUC-wrap only; NEEDS-COL.
 *   - `unit_failure_tags` → NO organization_id column; parent `serial_units`
 *                           HAS organization_id, so scope via a JOIN/subquery on
 *                           serial_units.organization_id. NEEDS-COL.
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

export async function listFailureModes(
  opts?: { activeOnly?: boolean },
  orgId?: OrgId,
): Promise<FailureModeRow[]> {
  const activeOnly = opts?.activeOnly === true;
  // failure_modes has NO organization_id column and no org-bearing parent
  // (reference-decide / NEEDS-COL): when orgId is present we can only GUC-wrap.
  const sql = `SELECT * FROM failure_modes
      WHERE ($1::boolean IS FALSE OR active = true)
      ORDER BY sort_order, label`;
  if (orgId) {
    const r = await tenantQuery<FailureModeRow>(orgId, sql, [activeOnly]);
    return r.rows;
  }
  const r = await pool.query(sql, [activeOnly]);
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
}, orgId?: OrgId): Promise<FailureModeRow> {
  // failure_modes DOES have organization_id (usav-fallback default until the
  // 2026-07-09a DEFAULT-drop migration flips it to loud-fail): stamp it
  // explicitly so the write never leans on the column default. When orgId is
  // present we also route through the tenant pool so the GUC is set
  // (RLS-ready) and the write is transactional.
  const sql = `INSERT INTO failure_modes
       (code, label, category, severity, is_repairable, typical_cost_cents, caps_grade_at, sort_order, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::condition_grade_enum, $8, $9)
     RETURNING *`;
  const values = [
    params.code.trim().toUpperCase(),
    params.label.trim(),
    params.category ?? 'hardware',
    params.severity ?? 'major',
    params.isRepairable ?? true,
    params.typicalCostCents ?? null,
    params.capsGradeAt ?? null,
    params.sortOrder ?? 0,
    orgId ?? null,
  ];
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const r = await client.query<FailureModeRow>(sql, values);
      return r.rows[0];
    });
  }
  const r = await pool.query(sql, values);
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
  orgId?: OrgId,
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
  // failure_modes has NO organization_id column (NEEDS-COL): no per-row org
  // predicate is possible. GUC-wrap only when orgId present (id is an integer
  // surrogate PK, safe bare).
  const sql = `UPDATE failure_modes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const r = await client.query<FailureModeRow>(sql, values);
      return r.rows[0] ?? null;
    });
  }
  const r = await pool.query(sql, values);
  return r.rows[0] ?? null;
}

/** Soft delete — deactivate so historical tags keep resolving their mode. */
export async function deactivateFailureMode(id: number, orgId?: OrgId): Promise<boolean> {
  // failure_modes has NO organization_id column (NEEDS-COL): GUC-wrap only.
  const sql = `UPDATE failure_modes SET active = false WHERE id = $1`;
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const r = await client.query(sql, [id]);
      return (r.rowCount || 0) > 0;
    });
  }
  const r = await pool.query(sql, [id]);
  return (r.rowCount || 0) > 0;
}

// ─── Per-unit tags ──────────────────────────────────────────────────────────

export async function listUnitFailureTags(
  serialUnitId: number,
  orgId?: OrgId,
): Promise<UnitFailureTagRow[]> {
  // unit_failure_tags has NO organization_id column; scope via its org-bearing
  // parent serial_units (su.organization_id = $n). t.serial_unit_id = su.id is
  // an integer surrogate-PK join (safe bare); the org predicate sits on su.
  if (orgId) {
    const r = await tenantQuery<UnitFailureTagRow>(
      orgId,
      `SELECT t.*, fm.code, fm.label, fm.category, fm.severity, fm.caps_grade_at,
              s.name AS detected_by_name
         FROM unit_failure_tags t
         JOIN serial_units su ON su.id = t.serial_unit_id
         JOIN failure_modes fm ON fm.id = t.failure_mode_id
    LEFT JOIN staff s ON s.id = t.detected_by_staff_id
        WHERE t.serial_unit_id = $1 AND su.organization_id = $2
     ORDER BY (t.resolution_status = 'open') DESC, t.detected_at DESC`,
      [serialUnitId, orgId],
    );
    return r.rows;
  }
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
}, orgId?: OrgId): Promise<UnitFailureTagRow> {
  const insertValues = [
    params.serialUnitId,
    params.failureModeId,
    params.detectedByStaffId ?? null,
    params.source ?? 'manual',
    params.notes?.trim() || null,
  ];

  // unit_failure_tags has NO organization_id column; scope through the
  // org-bearing parent serial_units. When orgId is present, the INSERT is
  // gated by an EXISTS on serial_units (cross-tenant unit → zero rows), and
  // the fallback SELECT joins serial_units with the org predicate.
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const inserted = await client.query<UnitFailureTagRow>(
        `INSERT INTO unit_failure_tags
           (serial_unit_id, failure_mode_id, detected_by_staff_id, source, notes)
         SELECT $1, $2, $3, $4, $5
          WHERE EXISTS (
            SELECT 1 FROM serial_units su
             WHERE su.id = $1 AND su.organization_id = $6
          )
         ON CONFLICT (serial_unit_id, failure_mode_id) WHERE resolution_status = 'open'
           DO NOTHING
         RETURNING *`,
        [...insertValues, orgId],
      );
      if (inserted.rows.length > 0) return inserted.rows[0];
      // Already an open tag (or a cross-tenant/non-existent unit) — return the
      // existing org-owned open tag, if any.
      const existing = await client.query<UnitFailureTagRow>(
        `SELECT t.* FROM unit_failure_tags t
           JOIN serial_units su ON su.id = t.serial_unit_id
          WHERE t.serial_unit_id = $1 AND t.failure_mode_id = $2
            AND t.resolution_status = 'open' AND su.organization_id = $3
          LIMIT 1`,
        [params.serialUnitId, params.failureModeId, orgId],
      );
      return existing.rows[0];
    });
  }

  const inserted = await pool.query(
    `INSERT INTO unit_failure_tags
       (serial_unit_id, failure_mode_id, detected_by_staff_id, source, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (serial_unit_id, failure_mode_id) WHERE resolution_status = 'open'
       DO NOTHING
     RETURNING *`,
    insertValues,
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

/**
 * Auto-resolve on QC re-pass (reversibility 5.9): flip the OPEN tag for
 * (unit, mode) to 'resolved'. Mirrors tagUnitFailure's org scoping — the
 * table has no organization_id column, so the UPDATE is gated by an EXISTS
 * on the org-bearing parent serial_units. Returns the resolved row, or null
 * when there was no open tag for that mode (idempotent no-op; a cross-tenant
 * unit also matches zero rows).
 */
export async function resolveOpenUnitFailureTagByMode(params: {
  serialUnitId: number;
  failureModeId: number;
  notes?: string | null;
}, orgId?: OrgId): Promise<UnitFailureTagRow | null> {
  const noteVal = params.notes?.trim() || null;
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const r = await client.query<UnitFailureTagRow>(
        `UPDATE unit_failure_tags t
            SET resolution_status = 'resolved',
                notes = COALESCE($3, t.notes)
          WHERE t.serial_unit_id = $1
            AND t.failure_mode_id = $2
            AND t.resolution_status = 'open'
            AND EXISTS (
              SELECT 1 FROM serial_units su
               WHERE su.id = t.serial_unit_id AND su.organization_id = $4
            )
          RETURNING t.*`,
        [params.serialUnitId, params.failureModeId, noteVal, orgId],
      );
      return r.rows[0] ?? null;
    });
  }
  const r = await pool.query<UnitFailureTagRow>(
    `UPDATE unit_failure_tags
        SET resolution_status = 'resolved',
            notes = COALESCE($3, notes)
      WHERE serial_unit_id = $1
        AND failure_mode_id = $2
        AND resolution_status = 'open'
      RETURNING *`,
    [params.serialUnitId, params.failureModeId, noteVal],
  );
  return r.rows[0] ?? null;
}

export async function resolveUnitFailureTag(
  tagId: number,
  status: 'resolved' | 'scrapped' | 'wontfix' | 'open',
  notes?: string | null,
  orgId?: OrgId,
): Promise<UnitFailureTagRow | null> {
  const noteVal = notes?.trim() || null;
  // unit_failure_tags has NO organization_id column; scope the UPDATE through
  // the org-bearing parent serial_units. A cross-tenant tag id matches zero
  // rows → returns null (org-ownership 404 at the route layer).
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const r = await client.query<UnitFailureTagRow>(
        `UPDATE unit_failure_tags t
            SET resolution_status = $2,
                notes = COALESCE($3, t.notes)
          WHERE t.id = $1
            AND EXISTS (
              SELECT 1 FROM serial_units su
               WHERE su.id = t.serial_unit_id AND su.organization_id = $4
            )
          RETURNING t.*`,
        [tagId, status, noteVal, orgId],
      );
      return r.rows[0] ?? null;
    });
  }
  const r = await pool.query(
    `UPDATE unit_failure_tags
        SET resolution_status = $2,
            notes = COALESCE($3, notes)
      WHERE id = $1
      RETURNING *`,
    [tagId, status, noteVal],
  );
  return r.rows[0] ?? null;
}
