export const fontFamilies = {
  sans: "'DM Sans', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  heading: "'DM Sans', 'Inter', system-ui, sans-serif",
  mono: "'SFMono-Regular', 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace",
} as const;

export type FontFamilies = typeof fontFamilies;
