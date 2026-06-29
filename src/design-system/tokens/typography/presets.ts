/**
 * Composed typography presets — Tailwind class strings for common text patterns.
 * These eliminate drift from hand-rolling the same size/weight/tracking combos.
 */

/** Section headers in sidebars, panels, and cards (e.g. "SHIPPING", "DETAILS") */
export const sectionLabel = 'text-micro font-black uppercase tracking-[0.2em] text-gray-500' as const;

/** Form field labels (e.g. "SKU *", "CONDITION") */
export const fieldLabel = 'text-micro font-bold uppercase tracking-[0.16em] text-gray-700' as const;

/** Primary data values (e.g. product titles, names) */
export const dataValue = 'text-sm font-bold text-gray-900' as const;

/** Monospace data values (e.g. serial numbers, tracking codes, SKUs) */
export const monoValue = 'text-sm font-bold font-mono text-gray-900' as const;

/** Chip / badge text (e.g. CopyChip display, ID chips in card headers) */
export const chipText = 'text-caption font-extrabold font-mono' as const;

/** PO line received/expected counts (e.g. accordion "1/3" meta) */
export const qtyProgress = 'text-caption font-bold font-mono tabular-nums leading-none' as const;

/** Card titles (e.g. OrderCard, FbaItemCard, RepairCard main heading) */
export const cardTitle = 'text-base font-black text-gray-900 leading-tight' as const;

/** Table column headers */
export const tableHeader = 'text-micro font-black uppercase tracking-[0.16em] text-gray-500' as const;

/** Table cell content */
export const tableCell = 'text-sm font-semibold text-gray-900' as const;

/** Micro badges (e.g. 8px uppercase labels, subtitle accents) */
export const microBadge = 'text-mini font-bold uppercase' as const;

export const typographyPresets = {
  sectionLabel,
  fieldLabel,
  dataValue,
  monoValue,
  chipText,
  qtyProgress,
  cardTitle,
  tableHeader,
  tableCell,
  microBadge,
} as const;

export type TypographyPresets = typeof typographyPresets;
