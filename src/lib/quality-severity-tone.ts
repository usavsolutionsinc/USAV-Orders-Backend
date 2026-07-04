// Single source of truth for QC failure-severity tones.
//
// Bordered chip. Consolidates the IDENTICAL `SEV_TONE` maps previously inlined
// in admin/QualityDashboardTab and labels/unit-detail/UnitQualityPanel. Hues
// follow the color story (DESIGN_SYSTEM.md): critical=danger, major=warning,
// minor=neutral. src/lib is in Tailwind's content globs.

export type QualitySeverity = 'critical' | 'major' | 'minor';

const TONES: Record<QualitySeverity, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  major: 'bg-amber-50 text-amber-700 border-amber-200',
  minor: 'bg-surface-canvas text-text-muted border-border-soft',
};

/** Bordered chip classes for a QC severity; falls back to `minor`. */
export function qualitySeverityToneClass(severity: string): string {
  return TONES[severity as QualitySeverity] ?? TONES.minor;
}
