import { SearchBar } from '@/components/ui/SearchBar';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import type { EcwidProductSearchController } from './useEcwidProductSearch';

/** The search-input area — one of four branches keyed on mode + manual flags. */
export function EcwidSearchInputs({
  c,
  autoFocusSearch = true,
}: {
  c: EcwidProductSearchController;
  autoFocusSearch?: boolean;
}) {
  const { popoverMode, manualTitleMode } = c;

  if (popoverMode === 'search' && !manualTitleMode) {
    return (
      <div className="px-2 pt-2">
        <SearchBar
          value={c.query}
          onChange={c.setQuery}
          placeholder={c.placeholder}
          autoFocus={autoFocusSearch}
          isSearching={c.isLoading}
          variant="blue"
          size="compact"
          hideUnderline
          trailingPrefix={
            <HoverTooltip label="Product not added yet?" asChild>
              <button
                type="button"
                onClick={() => {
                  c.setManualTitleMode(true);
                  c.setManualTitle('');
                  c.setQuery('');
                  c.setItems([]);
                  c.setError(null);
                  c.abortRef.current?.abort();
                  c.setIsLoading(false);
                }}
                aria-label="Product not added yet?"
                className="ds-raw-button max-w-[min(11rem,calc(100vw-200px))] shrink-0 truncate rounded-md border border-blue-200 bg-blue-50/80 px-1.5 py-0.5 text-left text-micro font-semibold text-blue-800 hover:bg-blue-100 sm:max-w-[14rem] sm:text-caption sm:leading-tight"
              >
                Product not added yet?
              </button>
            </HoverTooltip>
          }
        />
      </div>
    );
  }

  if (popoverMode === 'search' && manualTitleMode) {
    return (
      <div className="space-y-2 px-2 pt-2">
        <SearchBar
          value={c.manualTitle}
          onChange={c.setManualTitle}
          placeholder="Enter Product Title to add"
          autoFocus={autoFocusSearch}
          variant="blue"
          size="compact"
          hideUnderline
          onSearch={(v) => {
            if (v.trim()) void c.handleManualTitleSubmit();
          }}
        />
        <Button
          variant="primary"
          type="button"
          disabled={
            c.manualSubmitting || c.submittingId != null || !c.manualTitle.trim()
          }
          onClick={() => void c.handleManualTitleSubmit()}
          className="w-full disabled:bg-gray-300 disabled:opacity-100"
        >
          {c.manualSubmitting ? 'Adding…' : 'Add to carton'}
        </Button>
      </div>
    );
  }

  if (popoverMode === 'repair_service') {
    return (
      <div className="px-2 pt-2">
        <SearchBar
          value={c.repairFilter}
          onChange={c.setRepairFilter}
          placeholder="Filter by order #, title, or SKU…"
          autoFocus={autoFocusSearch}
          variant="blue"
          size="compact"
          hideUnderline
        />
      </div>
    );
  }

  return (
    <p className="px-3 pt-2 text-micro text-gray-500">
      Pick an order containing a repair-service SKU to link this carton.
    </p>
  );
}
