import pool from '@/lib/db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  computeQualityScore,
  type QualityInputs,
  type QualityResult,
  type ConditionGrade,
  type FailureSeverity,
} from '@/lib/quality/qualityScore';

/**
 * Gather inputs for, compute, and cache a unit's quality score
 * (unit_quality_scores). The score itself is pure (qualityScore.ts); this layer
 * only reads the unit's grade + open failures + repairs + sourcing and upserts
 * the projection. Cheap (a few indexed reads) — safe to call per mutation.
 */

export interface UnitQualityRow {
  serial_unit_id: number;
  quality_score: number;
  risk_level: string;
  risk_reasons: string[];
  ebay_condition_id: string | null;
  grade_at_score: string | null;
  computed_at: string;
}

/** Open failures shaped for grade-advice (label + cap), reused by the grade route. */
export interface OpenFailureForAdvice {
  label: string;
  severity: FailureSeverity;
  capsGradeAt: ConditionGrade | null;
}

export async function gatherQualityInputs(
  serialUnitId: number,
  orgId?: OrgId,
): Promise<{ inputs: QualityInputs; openFailures: OpenFailureForAdvice[] } | null> {
  // When orgId is present, run every read inside ONE tenant transaction so the
  // `app.current_org` GUC is consistent across the four queries and the
  // serial_units org-ownership gate applies. When omitted, keep the original
  // raw-pool behavior byte-identical for un-migrated callers.
  const run = orgId
    ? <T extends QueryResultRow>(text: string, params: unknown[]) =>
        tenantQuery<T>(orgId, text, params)
    : <T extends QueryResultRow>(text: string, params: unknown[]) =>
        pool.query<T>(text, params);

  const unit = orgId
    ? await run<{ condition_grade: string | null }>(
        // serial_units is org-owned: gate the lookup so a cross-tenant id
        // returns no rows -> null (natural ownership 404 for callers).
        `SELECT condition_grade::text AS condition_grade FROM serial_units WHERE id = $1 AND organization_id = $2`,
        [serialUnitId, orgId],
      )
    : await run<{ condition_grade: string | null }>(
        `SELECT condition_grade::text AS condition_grade FROM serial_units WHERE id = $1`,
        [serialUnitId],
      );
  if (unit.rows.length === 0) return null;

  const failures = orgId
    ? await run<{ label: string; severity: string; caps_grade_at: string | null }>(
        // unit_failure_tags has no organization_id (child of serial_units):
        // scope via the parent unit's org. failure_modes is a global reference
        // joined on its integer surrogate PK -> safe bare.
        `SELECT fm.label, fm.severity, fm.caps_grade_at::text AS caps_grade_at
           FROM unit_failure_tags t
           JOIN serial_units su ON su.id = t.serial_unit_id AND su.organization_id = $2
           JOIN failure_modes fm ON fm.id = t.failure_mode_id
          WHERE t.serial_unit_id = $1 AND t.resolution_status = 'open'`,
        [serialUnitId, orgId],
      )
    : await run<{ label: string; severity: string; caps_grade_at: string | null }>(
        `SELECT fm.label, fm.severity, fm.caps_grade_at::text AS caps_grade_at
           FROM unit_failure_tags t
           JOIN failure_modes fm ON fm.id = t.failure_mode_id
          WHERE t.serial_unit_id = $1 AND t.resolution_status = 'open'`,
        [serialUnitId],
      );

  const repairs = orgId
    ? await run<{ status: string }>(
        // unit_repairs is org-owned: filter explicitly.
        `SELECT status FROM unit_repairs WHERE serial_unit_id = $1 AND organization_id = $2`,
        [serialUnitId, orgId],
      )
    : await run<{ status: string }>(
        `SELECT status FROM unit_repairs WHERE serial_unit_id = $1`,
        [serialUnitId],
      );

  // Most recent acquisition for provenance (supplier type + condition).
  const acq = orgId
    ? await run<{ supplier_type: string | null; condition: string | null }>(
        // part_acquisitions has no organization_id (child of serial_units):
        // scope via the parent unit's org. suppliers has no org column yet
        // (NEEDS-COL) but is joined on its integer surrogate PK -> safe bare.
        `SELECT s.supplier_type, pa.condition
           FROM part_acquisitions pa
           JOIN serial_units su ON su.id = pa.serial_unit_id AND su.organization_id = $2
      LEFT JOIN suppliers s ON s.id = pa.supplier_id
          WHERE pa.serial_unit_id = $1
       ORDER BY COALESCE(pa.received_at, pa.ordered_at) DESC NULLS LAST, pa.id DESC
          LIMIT 1`,
        [serialUnitId, orgId],
      )
    : await run<{ supplier_type: string | null; condition: string | null }>(
        `SELECT s.supplier_type, pa.condition
           FROM part_acquisitions pa
      LEFT JOIN suppliers s ON s.id = pa.supplier_id
          WHERE pa.serial_unit_id = $1
       ORDER BY COALESCE(pa.received_at, pa.ordered_at) DESC NULLS LAST, pa.id DESC
          LIMIT 1`,
        [serialUnitId],
      );

  const openFailures: OpenFailureForAdvice[] = failures.rows.map((f) => ({
    label: f.label,
    severity: (f.severity as FailureSeverity) ?? 'minor',
    capsGradeAt: (f.caps_grade_at as ConditionGrade | null) ?? null,
  }));

  const inputs: QualityInputs = {
    grade: (unit.rows[0].condition_grade as ConditionGrade | null) ?? null,
    openFailures: openFailures.map((f) => ({ severity: f.severity })),
    repairs: repairs.rows.map((r) => ({ status: r.status })),
    acquisition: acq.rows[0]
      ? { supplierType: acq.rows[0].supplier_type, condition: acq.rows[0].condition }
      : null,
  };

  return { inputs, openFailures };
}

/** Recompute + cache. Returns the persisted row, or null if the unit is gone. */
export async function recomputeUnitQuality(
  serialUnitId: number,
  orgId?: OrgId,
): Promise<UnitQualityRow | null> {
  // Pass orgId through to the gather step: it org-gates the serial_units lookup,
  // so a cross-tenant id yields null here before any write happens.
  const gathered = await gatherQualityInputs(serialUnitId, orgId);
  if (!gathered) return null;
  const result: QualityResult = computeQualityScore(gathered.inputs);

  // unit_quality_scores has no organization_id (child of serial_units, NEEDS-COL):
  // can't stamp org on the row. The upsert is keyed on serial_unit_id, whose
  // org ownership gatherQualityInputs already validated above; when orgId is
  // present we still run GUC-wrapped (set_config app.current_org via the tenant
  // transaction) so RLS can backstop once a column/policy lands.
  const sql = `INSERT INTO unit_quality_scores
       (serial_unit_id, quality_score, risk_level, risk_reasons, ebay_condition_id, grade_at_score, computed_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::condition_grade_enum, NOW())
     ON CONFLICT (serial_unit_id) DO UPDATE
       SET quality_score = EXCLUDED.quality_score,
           risk_level = EXCLUDED.risk_level,
           risk_reasons = EXCLUDED.risk_reasons,
           ebay_condition_id = EXCLUDED.ebay_condition_id,
           grade_at_score = EXCLUDED.grade_at_score,
           computed_at = NOW()
     RETURNING serial_unit_id, quality_score, risk_level, risk_reasons, ebay_condition_id,
               grade_at_score::text AS grade_at_score, computed_at`;
  const params = [
    serialUnitId,
    result.score,
    result.riskLevel,
    JSON.stringify(result.riskReasons),
    result.ebayConditionId,
    gathered.inputs.grade,
  ];

  if (orgId) {
    const row = await withTenantTransaction(orgId, async (client: PoolClient) => {
      const r = await client.query<UnitQualityRow>(sql, params);
      return r.rows[0] ?? null;
    });
    return row;
  }

  const r = await pool.query<UnitQualityRow>(sql, params);
  return r.rows[0] ?? null;
}

/** Best-effort recompute — never throws (call from mutation routes). */
export async function recomputeUnitQualitySafe(
  serialUnitId: number,
  orgId?: OrgId,
): Promise<void> {
  try {
    await recomputeUnitQuality(serialUnitId, orgId);
  } catch (err) {
    console.warn('[quality] recompute failed (non-fatal) for unit', serialUnitId, err);
  }
}

export async function getUnitQuality(
  serialUnitId: number,
  orgId?: OrgId,
): Promise<UnitQualityRow | null> {
  // unit_quality_scores has no organization_id (child of serial_units, NEEDS-COL):
  // scope the read via the parent unit's org so a cross-tenant id returns null.
  if (orgId) {
    const r = await tenantQuery<UnitQualityRow>(
      orgId,
      `SELECT q.serial_unit_id, q.quality_score, q.risk_level, q.risk_reasons, q.ebay_condition_id,
              q.grade_at_score::text AS grade_at_score, q.computed_at
         FROM unit_quality_scores q
         JOIN serial_units su ON su.id = q.serial_unit_id AND su.organization_id = $2
        WHERE q.serial_unit_id = $1`,
      [serialUnitId, orgId],
    );
    return r.rows[0] ?? null;
  }

  const r = await pool.query<UnitQualityRow>(
    `SELECT serial_unit_id, quality_score, risk_level, risk_reasons, ebay_condition_id,
            grade_at_score::text AS grade_at_score, computed_at
       FROM unit_quality_scores WHERE serial_unit_id = $1`,
    [serialUnitId],
  );
  return r.rows[0] ?? null;
}
