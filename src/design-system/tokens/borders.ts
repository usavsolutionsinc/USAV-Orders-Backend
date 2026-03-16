export const borderWidths = {
  none: '0',
  thin: '1px',
  thick: '2px',
} as const;

export const borderStyles = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
} as const;

export type BorderWidths = typeof borderWidths;
