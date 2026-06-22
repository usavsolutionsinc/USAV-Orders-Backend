'use client';

/**
 * Shipped-list filters. Thin re-export barrel — the URL-param helpers, the
 * refinements hook, and the sidebar/inline filter components live under
 * `./shipped-filter/`. Public surface preserved for existing importers.
 */

import { ShippedCarrierFilters } from './shipped-filter/ShippedCarrierFilters';

export {
  readShippedCarrierFilter,
  readShippedStatusFilter,
  readShippedExceptionsFilter,
} from './shipped-filter/shipped-filter-params';
export { useShippedFilterRefinements } from './shipped-filter/useShippedFilterRefinements';
export { ShippedFilterDropdown } from './shipped-filter/ShippedFilterDropdown';
export { ShippedCarrierFilters } from './shipped-filter/ShippedCarrierFilters';

/** @deprecated Use {@link ShippedCarrierFilters} in the sidebar instead. */
export function ShippedFilterToolbar(props: { className?: string; basePath?: string }) {
  return <ShippedCarrierFilters {...props} layout="inline" />;
}
