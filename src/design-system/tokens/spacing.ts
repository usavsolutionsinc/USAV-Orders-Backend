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

export type Spacing = typeof spacing;
