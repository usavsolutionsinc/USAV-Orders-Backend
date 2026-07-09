'use client';

import { ConditionGradeChip } from '@/components/ui/CopyChip';
import { useConditionGradeStyle, type ConditionGradeStyleSize } from '@/hooks/useConditionGradeStyle';

/**
 * Small condition-grade readout. Extracted into its own leaf module so
 * `ReceivingUnitRows` and `UnitSlotList` can both render it without importing
 * each other (which formed a runtime cycle). `ReceivingUnitRows` re-exports it
 * for backwards compatibility.
 *
 * `size="meta"` renders the shared {@link ConditionGradeChip}; `compact` keeps
 * the lightweight text badge for tight unit-row slots.
 */
export function ConditionBadge({
  grade,
  size = 'compact',
}: {
  grade: string | null | undefined;
  size?: ConditionGradeStyleSize;
}) {
  const { textClass, label } = useConditionGradeStyle(grade, size);
  if (size === 'meta') {
    return <ConditionGradeChip grade={grade} />;
  }
  return <span className={textClass}>{label}</span>;
}
