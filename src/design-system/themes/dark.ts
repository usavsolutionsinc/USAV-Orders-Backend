import { baseColors } from '../tokens';

export const darkTheme = {
  name: 'dark',
  colors: {
    text: {
      primary: baseColors.gray[50],
      secondary: baseColors.gray[300],
      muted: baseColors.gray[400],
      inverse: baseColors.gray[950],
      accent: baseColors.blue[300],
      success: baseColors.emerald[300],
      warning: baseColors.orange[300],
      danger: baseColors.red[300],
    },
    background: {
      canvas: baseColors.gray[950],
      surface: baseColors.gray[900],
      subtle: baseColors.gray[800],
      inverse: baseColors.white,
      accent: baseColors.blue[500],
      success: baseColors.emerald[500],
      warning: baseColors.orange[500],
      danger: baseColors.red[500],
    },
    border: {
      subtle: baseColors.gray[800],
      strong: baseColors.gray[700],
      accent: baseColors.blue[700],
      success: baseColors.emerald[700],
      warning: baseColors.orange[700],
      danger: baseColors.red[700],
    },
    focus: {
      ring: baseColors.blue[400],
      success: baseColors.emerald[400],
      warning: baseColors.orange[400],
      danger: baseColors.red[400],
    },
  },
} as const;

export type DarkTheme = typeof darkTheme;
