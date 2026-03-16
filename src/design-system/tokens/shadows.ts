export const shadows = {
  xs: '0 1px 2px rgba(15, 23, 42, 0.05)',
  sm: '0 1px 3px rgba(15, 23, 42, 0.08)',
  md: '0 12px 24px rgba(15, 23, 42, 0.08)',
  lg: '0 18px 40px rgba(15, 23, 42, 0.12)',
  xl: '0 24px 48px rgba(15, 23, 42, 0.16)',
  inner: 'inset 0 1px 2px rgba(15, 23, 42, 0.08)',
} as const;

export type Shadows = typeof shadows;
