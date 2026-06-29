import { useMemo } from 'react';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';
import {
  conditionGradeTextClass,
  normalizeConditionGrade,
} from '@/lib/condition-tone';

export type ConditionGradeStyleSize = 'compact' | 'meta';

const SIZE_CLASS: Record<ConditionGradeStyleSize, string> = {
  compact: 'text-micro font-bold uppercase tracking-widest',
  meta: 'text-sm font-bold uppercase tracking-widest',
};

/**
 * Resolves condition-grade label + text color from the shared pill tone registry.
 * Use wherever an inline condition readout should match {@link ConditionPills}.
 */
export function useConditionGradeStyle(
  grade: string | null | undefined,
  size: ConditionGradeStyleSize = 'compact',
) {
  return useMemo(() => {
    const code = normalizeConditionGrade(grade);
    const isPending = !code || code === 'PENDING';
    const textTone = isPending ? 'text-gray-400' : conditionGradeTextClass(code);
    return {
      code,
      isPending,
      label: isPending ? 'pending' : conditionGradeTableLabel(code),
      textClass: `${SIZE_CLASS[size]} ${textTone}`,
    };
  }, [grade, size]);
}
