export const fontSizes = {
  technicalLabel: '0.5625rem',
  dataValue: '0.8125rem',
  xs: '0.75rem',
  sm: '0.875rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem',
  '4xl': '2.25rem',
} as const;

export const lineHeights = {
  compact: 1,
  tight: 1.1,
  snug: 1.25,
  normal: 1.5,
  relaxed: 1.625,
} as const;

export const letterSpacings = {
  tighter: '-0.04em',
  tight: '-0.02em',
  normal: '0',
  wide: '0.04em',
  wider: '0.08em',
  anchor: '0.10rem',
  ledger: '0.16em',
  widest: '0.14em',
} as const;

export type FontSizes = typeof fontSizes;
