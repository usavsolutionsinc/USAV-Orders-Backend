/**
 * Pure quality-scoring + grade-advice for the Condition Grading QC System
 * (docs/condition-grading-repair-qc-plan.md §5). No DB access — inputs are
 * gathered by quality-queries.ts and the output is cached in unit_quality_scores.
 *
 * Compute-and-display only in v1: ebayConditionId is a mapping, not a live push.
 */

export type ConditionGrade =
  | 'BRAND_NEW' | 'LIKE_NEW' | 'REFURBISHED' | 'USED_A' | 'USED_B' | 'USED_C' | 'PARTS';

export type RiskLevel = 'low' | 'medium' | 'high';
export type FailureSeverity = 'critical' | 'major' | 'minor';

export interface QualityInputs {
  grade: ConditionGrade | null;
  openFailures: { severity: FailureSeverity }[];
  repairs: { status: string }[];
  acquisition: { supplierType: string | null; condition: string | null } | null;
}

export interface QualityResult {
  score: number;          // 0–100
  riskLevel: RiskLevel;
  riskReasons: string[];
  ebayConditionId: string | null;
}

/** Best-case score for a grade, before defect/repair/source adjustments. */
const GRADE_BASE: Record<ConditionGrade, number> = {
  BRAND_NEW: 100,
  LIKE_NEW: 92,
  REFURBISHED: 85,
  USED_A: 78,
  USED_B: 68,
  USED_C: 55,
  PARTS: 10,
};
/** Unknown grade — neutral-low until graded. */
const UNGRADED_BASE = 60;

const SEVERITY_PENALTY: Record<FailureSeverity, number> = {
  critical: 25,
  major: 12,
  minor: 5,
};

/** eBay item-condition ids (Browse/Inventory). Cross-checked vs CONDITION_FILTER. */
const GRADE_TO_EBAY_CONDITION: Record<ConditionGrade, string> = {
  BRAND_NEW: '1000',   // New
  LIKE_NEW: '1500',    // New other
  REFURBISHED: '2500', // Seller refurbished
  USED_A: '3000',      // Used
  USED_B: '3000',
  USED_C: '3000',
  PARTS: '7000',       // For parts or not working
};

/** Supplier types that make an item "third-party sourced" (buyer-risk signal). */
const THIRD_PARTY_SUPPLIERS = new Set(['ebay_seller', 'salvage', 'marketplace']);

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

export function gradeToEbayConditionId(grade: ConditionGrade | null): string | null {
  return grade ? GRADE_TO_EBAY_CONDITION[grade] : null;
}

export function computeQualityScore(inputs: QualityInputs): QualityResult {
  const { grade, openFailures, repairs, acquisition } = inputs;
  const reasons = new Set<string>();

  let score = grade ? GRADE_BASE[grade] : UNGRADED_BASE;
  if (!grade) reasons.add('ungraded');

  // Open defects drag the score by severity.
  let hasCritical = false;
  for (const f of openFailures) {
    score -= SEVERITY_PENALTY[f.severity] ?? SEVERITY_PENALTY.minor;
    if (f.severity === 'critical') hasCritical = true;
  }
  if (openFailures.length > 0) reasons.add('open_failures');
  if (hasCritical) reasons.add('open_critical_failure');

  // Repair history: a prior failed/scrapped attempt is a confidence hit; a
  // completed repair is a mild confidence boost (it was fixed and verified).
  const failedRepairs = repairs.filter((r) => r.status === 'failed' || r.status === 'scrapped').length;
  const completedRepairs = repairs.filter((r) => r.status === 'completed').length;
  if (failedRepairs > 0) {
    score -= 10 * failedRepairs;
    reasons.add('prior_failed_repair');
  }
  if (completedRepairs > 0) {
    score += Math.min(6, 3 * completedRepairs);
    reasons.add('refurbished_repair');
  }

  // Sourcing provenance.
  if (acquisition) {
    if (acquisition.supplierType && THIRD_PARTY_SUPPLIERS.has(acquisition.supplierType)) {
      reasons.add('third_party_source');
      if (acquisition.supplierType === 'salvage') reasons.add('salvage_source');
    }
    if (acquisition.condition === 'for_parts') {
      score -= 20;
      reasons.add('for_parts_source');
    }
  }

  score = clamp(Math.round(score));

  // Risk band: score-driven, floored by hard signals.
  let riskLevel: RiskLevel = score >= 80 ? 'low' : score >= 55 ? 'medium' : 'high';
  if (hasCritical && riskLevel === 'low') riskLevel = 'medium';
  if (reasons.has('for_parts_source') || grade === 'PARTS') riskLevel = 'high';

  return {
    score,
    riskLevel,
    riskReasons: [...reasons],
    ebayConditionId: gradeToEbayConditionId(grade),
  };
}
