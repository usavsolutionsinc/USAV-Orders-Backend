// Single source of truth for inventory velocity-tier (A/B/C/D) tones.
//
// Nested meta: `bg` (solid dot/segment fill) + `ring` (pastel chip bg) + label.
// Single surface today (features/operations/VelocityAndDeadStock). Values
// preserved verbatim; hues: A=success, B=warning, C=orange (slow), D=danger
// (dead). src/lib is in Tailwind's content globs.

export type VelocityTier = 'A' | 'B' | 'C' | 'D';

export interface VelocityTierMeta {
  /** Solid fill (donut segment / dot). */
  bg: string;
  /** Pastel chip background. */
  ring: string;
  label: string;
}

const META: Record<VelocityTier, VelocityTierMeta> = {
  A: { bg: 'bg-emerald-500', ring: 'bg-emerald-50', label: 'Fast (A)' },
  B: { bg: 'bg-amber-500', ring: 'bg-amber-50', label: 'Medium (B)' },
  C: { bg: 'bg-orange-500', ring: 'bg-orange-50', label: 'Slow (C)' },
  D: { bg: 'bg-rose-500', ring: 'bg-rose-50', label: 'Dead (D)' },
};

const FALLBACK: VelocityTierMeta = { bg: 'bg-border-emphasis', ring: 'bg-surface-canvas', label: 'Unknown' };

/** Fill/chip/label meta for a velocity tier; safe for unknown values. */
export function velocityTierMeta(tier: string): VelocityTierMeta {
  return META[tier as VelocityTier] ?? FALLBACK;
}
