export const borderWidths = {
  none: '0',
  ghost: '1px',
  thin: '1px',
  anchor: '2px',
  thick: '2px',
} as const;

export const borderStyles = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
} as const;

export type BorderWidths = typeof borderWidths;
