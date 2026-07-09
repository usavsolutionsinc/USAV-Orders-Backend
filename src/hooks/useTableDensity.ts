'use client';

import { useTableDensityContext } from '@/components/ui/table-density/TableDensityProvider';
import { TABLE_DENSITY_CLASSES, type TableDensity, type TableDensityClasses } from '@/lib/tables/table-density';

export interface UseTableDensityResult {
  density: TableDensity;
  setDensity: (next: TableDensity) => void;
  /** Resolved class bundle for the active density — rows apply these. */
  classes: TableDensityClasses;
}

/**
 * Read the active row density (+ its resolved class bundle) for the nearest
 * {@link TableDensityProvider}. Outside a provider it returns `comfortable` and a
 * no-op setter, so a row that reads it in a non-station context is unaffected.
 */
export function useTableDensity(): UseTableDensityResult {
  const { density, setDensity } = useTableDensityContext();
  return { density, setDensity, classes: TABLE_DENSITY_CLASSES[density] };
}
