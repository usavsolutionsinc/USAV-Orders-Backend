// Single source of truth for staff goal-progress status tones.
//
// Nested meta (ring hex + dot + chip + label) — `ring` feeds the SVG goal-ring
// stroke. Single surface today: StaffGoalsRail. Classes/values preserved
// verbatim; hues follow the color story (DESIGN_SYSTEM.md): on_track=success,
// at_risk=warning, behind=danger. src/lib is in Tailwind content globs.

export type StaffGoalStatus = 'on_track' | 'at_risk' | 'behind';

export interface StaffGoalStatusMeta {
  /** Hex stroke color for the SVG goal ring. */
  ring: string;
  dot: string;
  chip: string;
  label: string;
}

const META: Record<StaffGoalStatus, StaffGoalStatusMeta> = {
  on_track: { ring: '#6B9080', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700', label: 'On track' },
  at_risk: { ring: '#F59E0B', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700', label: 'Close to goal' },
  behind: { ring: '#E07A5F', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700', label: 'Behind' },
};

/** Ring/dot/chip/label meta for a staff goal status; falls back to `behind`. */
export function staffGoalStatusMeta(status: StaffGoalStatus): StaffGoalStatusMeta {
  return META[status] ?? META.behind;
}
