export const spacing = {
  0: '0',
  px: '1px',
  1: '0.2rem',
  2: '0.4rem',
  3: '0.6rem',
  4: '0.9rem',
  5: '1.2rem',
  6: '1.6rem',
  8: '2rem',
  10: '2.4rem',
  12: '2.8rem',
  16: '3.6rem',
  20: '4.4rem',
  24: '5.2rem',
  rhythmMajor: '0.9rem',
  ledgerTight: '0.2rem',
  ledgerCompact: '0.4rem',
  ledgerComfort: '0.6rem',
} as const;

/** Density presets — standard px/py/gap combos used across components */
export const density = {
  /** Table rows, compact data */
  compact: { px: '0.5rem', py: '0.375rem', gap: '0.375rem' },
  /** Sidebar rows, cards */
  standard: { px: '0.75rem', py: '0.5rem', gap: '0.5rem' },
  /** Form fields, panels */
  spacious: { px: '1rem', py: '0.75rem', gap: '0.75rem' },
} as const;

export type Spacing = typeof spacing;
export type Density = typeof density;
