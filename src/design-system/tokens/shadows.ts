export const shadows = {
  none: 'none',
  xs: '0 2px 8px rgba(15, 23, 42, 0.02)',
  sm: '0 6px 16px rgba(15, 23, 42, 0.03)',
  md: '0 10px 24px rgba(15, 23, 42, 0.04)',
  lg: '0 14px 32px rgba(15, 23, 42, 0.04)',
  xl: '0 20px 42px rgba(15, 23, 42, 0.04)',
  surfaceDim: '0 12px 28px rgba(15, 23, 42, 0.04)',
  glassOverlay: '0 16px 44px rgba(15, 23, 42, 0.04)',
  inner: 'inset 0 1px 0 rgba(100, 116, 139, 0.10)',
} as const;

export type Shadows = typeof shadows;
