import { baseColors, semanticColors } from '../tokens';

export const lightTheme = {
  name: 'light',
  colors: semanticColors,
  surfaces: {
    page: semanticColors.surface.background,
    panel: semanticColors.surface.containerLowest,
    elevated: semanticColors.surface.containerLow,
    containerLow: semanticColors.surface.containerLow,
    container: semanticColors.surface.container,
    containerHigh: semanticColors.surface.containerHigh,
    containerHighest: semanticColors.surface.containerHighest,
  },
  gradients: {
    primaryZone: `linear-gradient(180deg, ${semanticColors.gradient.primary}, ${semanticColors.gradient.primaryDim})`,
  },
  overlays: {
    scrim: semanticColors.overlay.scrim,
    glass: semanticColors.overlay.glass,
  },
  tonalNesting: {
    recessed: semanticColors.tonalNesting.recessed,
    neutral: semanticColors.tonalNesting.neutral,
    lifted: semanticColors.tonalNesting.lifted,
  },
  functional: semanticColors.functional,
  signature: {
    ghostBorder: semanticColors.outline.ghost,
    lineBorder: semanticColors.outline.variant,
  },
  primitives: {
    noBox: true,
    radius: 0,
  },
  fallback: {
    neutralSurface: baseColors.white,
  },
} as const;

export type LightTheme = typeof lightTheme;
