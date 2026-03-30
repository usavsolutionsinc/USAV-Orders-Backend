export const radii = {
  /** Data rows, table cells, inline values */
  none: '0',
  /** Small chips, badges */
  sm: '0.375rem',
  /** Buttons, inputs */
  md: '0.5rem',
  /** Cards, dropdowns */
  lg: '0.75rem',
  /** Panels, form fields */
  xl: '1rem',
  /** Sidebar sections, modals */
  '2xl': '1.25rem',
  /** Overlay cards, large containers */
  '3xl': '1.5rem',
  /** Pills, circular buttons */
  full: '9999px',
} as const;

export type Radii = typeof radii;
