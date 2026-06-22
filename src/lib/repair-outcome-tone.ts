// Single source of truth for unit repair-history OUTCOME tones.
//
// Distinct from repair-service workflow status (see repair-status.ts) — this is
// the per-repair outcome shown in the unit quality panel. Flat chip. Single
// surface today (labels/unit-detail/UnitQualityPanel). Hues follow the color
// story (DESIGN_SYSTEM.md): completed=success, in_progress=info, pending=neutral,
// failed/scrapped=danger. src/lib is in Tailwind's content globs.

export type RepairOutcome = 'completed' | 'in_progress' | 'pending' | 'failed' | 'scrapped';

const TONES: Record<RepairOutcome, string> = {
  completed: 'bg-emerald-50 text-emerald-700',
  in_progress: 'bg-blue-50 text-blue-700',
  pending: 'bg-gray-100 text-gray-600',
  failed: 'bg-rose-50 text-rose-700',
  scrapped: 'bg-rose-50 text-rose-700',
};

const FALLBACK = 'bg-gray-100 text-gray-600';

/** Flat chip classes for a repair outcome; safe for unknown values. */
export function repairOutcomeToneClass(status: string): string {
  return TONES[status as RepairOutcome] ?? FALLBACK;
}
