/**
 * Advisory grade signals — NEVER blocking (docs/condition-grading-repair-qc-plan
 * §5.1). Surfaces warnings when a chosen grade is more optimistic than the
 * unit's open failures allow. The grade write always succeeds; the UI shows
 * these as a soft "grade anyway?" confirm.
 */

import type { ConditionGrade } from './qualityScore';

/** Worst-to-best is high index → low index. Lower index = better grade. */
const GRADE_RANK: Record<ConditionGrade, number> = {
  BRAND_NEW: 0,
  LIKE_NEW: 1,
  REFURBISHED: 2,
  USED_A: 3,
  USED_B: 4,
  USED_C: 5,
  PARTS: 6,
};

export interface GradeAdviceInput {
  grade: ConditionGrade;
  openFailures: { label: string; severity: string; capsGradeAt: ConditionGrade | null }[];
}

export interface GradeWarning {
  kind: 'grade_cap' | 'open_failure';
  message: string;
}

export function evaluateGradeAdvice(input: GradeAdviceInput): { warnings: GradeWarning[] } {
  const warnings: GradeWarning[] = [];
  const chosenRank = GRADE_RANK[input.grade];

  for (const f of input.openFailures) {
    if (f.capsGradeAt) {
      const capRank = GRADE_RANK[f.capsGradeAt];
      // Chosen grade is *better* (lower rank) than the cap → over-optimistic.
      if (chosenRank < capRank) {
        warnings.push({
          kind: 'grade_cap',
          message: `“${f.label}” caps grade at ${f.capsGradeAt} — ${input.grade} may be too high.`,
        });
      }
    } else if (f.severity === 'critical') {
      warnings.push({
        kind: 'open_failure',
        message: `Open critical failure “${f.label}” is unresolved.`,
      });
    }
  }

  return { warnings };
}
