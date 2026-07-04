import { ResultRow } from './ecwid-search-rows';
import type { EcwidProductSearchController } from './useEcwidProductSearch';

/** Results listbox with the mode-specific empty/loading states. */
export function EcwidResultsList({ c }: { c: EcwidProductSearchController }) {
  const {
    listboxId, popoverMode, error, isLoading, manualTitleMode, query, items,
    visibleItems, submittingId, orderScope,
  } = c;

  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={
        popoverMode === 'repair_service'
          ? orderScope === 'all'
            ? 'Recent Ecwid order lines'
            : 'Recent repair-service order lines'
          : 'Ecwid product results'
      }
      className="min-h-[120px] flex-1 overflow-y-auto"
    >
      {error && (
        <li className="px-3 py-3 text-label text-red-600">{error}</li>
      )}

      {!error &&
        !isLoading &&
        popoverMode === 'search' &&
        !manualTitleMode &&
        query.trim() &&
        items.length === 0 && (
        <li className="px-3 py-3 text-label text-text-soft">
          No matches. Try the other mode, refine the query, or use &ldquo;Product not added yet?&rdquo; for a
          manual title.
        </li>
      )}

      {!error &&
        !isLoading &&
        popoverMode === 'repair_service' &&
        items.length === 0 && (
        <li className="px-3 py-3 text-label text-text-soft">
          {orderScope === 'all'
            ? 'No recent Ecwid orders found.'
            : 'No recent repair-service line items (-RS SKU) found.'}
        </li>
      )}

      {!error &&
        !isLoading &&
        popoverMode === 'repair_service' &&
        items.length > 0 &&
        visibleItems.length === 0 && (
        <li className="px-3 py-3 text-label text-text-soft">
          No recent orders match that filter.
        </li>
      )}

      {!error &&
        popoverMode === 'repair_service' &&
        isLoading &&
        items.length === 0 && (
          <li className="px-3 py-4 text-micro font-semibold text-text-faint">
            Loading recent Ecwid orders…
          </li>
        )}

      {(popoverMode === 'repair_service' ? visibleItems : items).map((item) => (
        <ResultRow
          key={item.id}
          item={item}
          showOrderMeta={popoverMode === 'repair_service'}
          isSubmitting={submittingId === item.id}
          disabled={submittingId != null && submittingId !== item.id}
          onSelect={c.handleSelect}
        />
      ))}
    </ul>
  );
}
