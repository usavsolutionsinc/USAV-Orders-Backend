/**
 * Table row-density — the single source of truth for the station/queue tables'
 * comfortable ⇄ compact toggle (station-table-unification-plan §3.5 / §6.1).
 *
 * Two modes change padding, meta text size, and chip gap ONLY — never the type
 * scale beyond the named `text-micro` token, so readability never degrades. Rows
 * (`OrdersQueueTableRow`, `ReceivingLineOrderRow`, group summaries) read the
 * class bundle from here via {@link useTableDensity} instead of hardcoding
 * per-density Tailwind, keeping every row in sync — the same single-source rule
 * the design-system invariants enforce elsewhere.
 */

export type TableDensity = 'comfortable' | 'compact';

/** All densities in toggle/menu order. */
export const TABLE_DENSITIES: TableDensity[] = ['comfortable', 'compact'];

export const DEFAULT_TABLE_DENSITY: TableDensity = 'comfortable';

/** URL param carrying the active density (`?density=compact`). */
export const DENSITY_PARAM = 'density';

export function isTableDensity(value: unknown): value is TableDensity {
  return value === 'comfortable' || value === 'compact';
}

/** localStorage key so each `tableId` remembers its own density when the URL is clean. */
export function tableDensityStorageKey(tableId: string): string {
  return `table-density:${tableId}`;
}

/** Human label for the density menu. */
export const TABLE_DENSITY_LABEL: Record<TableDensity, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
};

/** The class bundle a row applies for a given density (rows read this, not literals). */
export interface TableDensityClasses {
  /** Vertical row padding. */
  rowPadding: string;
  /** Meta eyebrow text size override (empty = default scale). */
  metaText: string;
  /** Chip cluster gap. */
  chipGap: string;
}

export const TABLE_DENSITY_CLASSES: Record<TableDensity, TableDensityClasses> = {
  comfortable: { rowPadding: 'py-1.5', metaText: '', chipGap: '' },
  compact: { rowPadding: 'py-1', metaText: 'text-micro', chipGap: 'gap-0.5' },
};
