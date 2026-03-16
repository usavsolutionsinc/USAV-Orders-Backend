import { baseColors } from './base';

export const semanticColors = {
  text: {
    primary: baseColors.gray[900],
    secondary: baseColors.gray[600],
    muted: baseColors.gray[500],
    inverse: baseColors.white,
    accent: baseColors.blue[600],
    success: baseColors.emerald[600],
    warning: baseColors.orange[600],
    danger: baseColors.red[600],
  },
  background: {
    canvas: baseColors.gray[50],
    surface: baseColors.white,
    subtle: baseColors.gray[100],
    inverse: baseColors.gray[900],
    accent: baseColors.blue[600],
    success: baseColors.emerald[500],
    warning: baseColors.orange[500],
    danger: baseColors.red[500],
  },
  border: {
    subtle: baseColors.gray[200],
    strong: baseColors.gray[300],
    accent: baseColors.blue[300],
    success: baseColors.emerald[300],
    warning: baseColors.orange[300],
    danger: baseColors.red[300],
  },
  focus: {
    ring: baseColors.blue[500],
    success: baseColors.emerald[500],
    warning: baseColors.orange[500],
    danger: baseColors.red[500],
  },
} as const;

export type SemanticColors = typeof semanticColors;
