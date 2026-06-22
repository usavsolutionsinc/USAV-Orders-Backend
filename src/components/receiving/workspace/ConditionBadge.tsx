import { conditionGradeTableLabel } from '@/components/station/receiving-constants';

/**
 * Small condition-grade pill. Extracted into its own leaf module so
 * `ReceivingUnitRows` and `UnitSlotList` can both render it without importing
 * each other (which formed a runtime cycle). `ReceivingUnitRows` re-exports it
 * for backwards compatibility.
 */
export function ConditionBadge({ grade }: { grade: string | null | undefined }) {
  const g = String(grade || '').trim().toUpperCase();
  if (!g || g === 'PENDING') {
    return <span className="text-micro font-bold uppercase tracking-widest text-gray-400">pending</span>;
  }
  const tone =
    g === 'BRAND_NEW'
      ? 'text-yellow-600'
      : g === 'PARTS'
        ? 'text-amber-800'
        : g.startsWith('USED')
          ? 'text-gray-600'
          : 'text-gray-500';
  return (
    <span className={`text-micro font-bold uppercase tracking-widest ${tone}`}>
      {conditionGradeTableLabel(g)}
    </span>
  );
}
