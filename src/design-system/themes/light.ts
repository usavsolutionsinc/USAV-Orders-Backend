import { baseColors, semanticColors } from '../tokens';

export const lightTheme = {
  name: 'light',
  colors: semanticColors,
  surfaces: {
    page: baseColors.gray[50],
    panel: baseColors.white,
    elevated: baseColors.white,
  },
} as const;

export type LightTheme = typeof lightTheme;
