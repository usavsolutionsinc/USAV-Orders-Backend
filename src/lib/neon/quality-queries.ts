import pool from '@/lib/db';
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
): Promise<{ inputs: QualityInputs; openFailures: OpenFailureForAdvice[] } | null> {
  const unit = await pool.query<{ condition_grade: string | null }>(
    `SELECT condition_grade::text AS condition_grade FROM serial_units WHERE id = $1`,
    [serialUnitId],
  );
  if (unit.rows.length === 0) return null;

  const failures = await pool.query<{ label: string; severity: string; caps_grade_at: string | null }>(
    `SELECT fm.label, fm.severity, fm.caps_grade_at::text AS caps_grade_at
       FROM unit_failure_tags t
       JOIN failure_modes fm ON fm.id = t.failure_mode_id
      WHERE t.serial_unit_id = $1 AND t.resolution_status = 'open'`,
    [serialUnitId],
  );

  const repairs = await pool.query<{ status: string }>(
    `SELECT status FROM unit_repairs WHERE serial_unit_id = $1`,
    [serialUnitId],
  );

  // Most recent acquisition for provenance (supplier type + condition).
  const acq = await pool.query<{ supplier_type: string | null; condition: string | null }>(
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
export async function recomputeUnitQuality(serialUnitId: number): Promise<UnitQualityRow | null> {
  const gathered = await gatherQualityInputs(serialUnitId);
  if (!gathered) return null;
  const result: QualityResult = computeQualityScore(gathered.inputs);

  const r = await pool.query<UnitQualityRow>(
    `INSERT INTO unit_quality_scores
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
               grade_at_score::text AS grade_at_score, computed_at`,
    [
      serialUnitId,
      result.score,
      result.riskLevel,
      JSON.stringify(result.riskReasons),
      result.ebayConditionId,
      gathered.inputs.grade,
    ],
  );
  return r.rows[0] ?? null;
}

/** Best-effort recompute — never throws (call from mutation routes). */
export async function recomputeUnitQualitySafe(serialUnitId: number): Promise<void> {
  try {
    await recomputeUnitQuality(serialUnitId);
  } catch (err) {
    console.warn('[quality] recompute failed (non-fatal) for unit', serialUnitId, err);
  }
}

export async function getUnitQuality(serialUnitId: number): Promise<UnitQualityRow | null> {
  const r = await pool.query<UnitQualityRow>(
    `SELECT serial_unit_id, quality_score, risk_level, risk_reasons, ebay_condition_id,
            grade_at_score::text AS grade_at_score, computed_at
       FROM unit_quality_scores WHERE serial_unit_id = $1`,
    [serialUnitId],
  );
  return r.rows[0] ?? null;
}
