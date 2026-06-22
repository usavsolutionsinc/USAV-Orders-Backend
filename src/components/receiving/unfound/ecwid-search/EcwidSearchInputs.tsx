import { SearchBar } from '@/components/ui/SearchBar';
import type { EcwidProductSearchController } from './useEcwidProductSearch';

/** The search-input area — one of four branches keyed on mode + manual flags. */
export function EcwidSearchInputs({ c }: { c: EcwidProductSearchController }) {
  const { popoverMode, manualTitleMode, repairManualMode } = c;

  if (popoverMode === 'search' && !manualTitleMode) {
    return (
      <div className="px-2 pt-2">
        <SearchBar
          value={c.query}
          onChange={c.setQuery}
          placeholder={c.placeholder}
          autoFocus
          isSearching={c.isLoading}
          variant="blue"
          size="compact"
          hideUnderline
          trailingPrefix={
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
              className="max-w-[min(11rem,calc(100vw-200px))] shrink-0 truncate rounded-md border border-blue-200 bg-blue-50/80 px-1.5 py-0.5 text-left text-[10px] font-semibold text-blue-800 hover:bg-blue-100 sm:max-w-[14rem] sm:text-caption sm:leading-tight"
              title="Product not added yet?"
            >
              Product not added yet?
            </button>
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
          autoFocus
          variant="blue"
          size="compact"
          hideUnderline
          onSearch={(v) => {
            if (v.trim()) void c.handleManualTitleSubmit();
          }}
        />
        <button
          type="button"
          disabled={
            c.manualSubmitting || c.submittingId != null || !c.manualTitle.trim()
          }
          onClick={() => void c.handleManualTitleSubmit()}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-caption font-bold uppercase tracking-wider text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {c.manualSubmitting ? 'Adding…' : 'Add to carton'}
        </button>
      </div>
    );
  }

  if (popoverMode === 'repair_service' && !repairManualMode) {
    return (
      <div className="px-2 pt-2">
        <SearchBar
          value={c.repairFilter}
          onChange={c.setRepairFilter}
          placeholder="Filter by order #, title, or SKU…"
          autoFocus
          variant="blue"
          size="compact"
          hideUnderline
          trailingPrefix={
            <button
              type="button"
              onClick={() => {
                c.setRepairManualMode(true);
                c.setManualOrderId(c.repairFilter.trim().replace(/^#/, ''));
                c.setManualTitle('');
              }}
              className="max-w-[min(11rem,calc(100vw-200px))] shrink-0 truncate rounded-md border border-blue-200 bg-blue-50/80 px-1.5 py-0.5 text-left text-[10px] font-semibold text-blue-800 hover:bg-blue-100 sm:max-w-[14rem] sm:text-caption sm:leading-tight"
              title="Order not in the list? Enter it manually"
            >
              Order not listed?
            </button>
          }
        />
      </div>
    );
  }

  if (popoverMode === 'repair_service' && repairManualMode) {
    return (
      <div className="space-y-2 px-2 pt-2">
        <SearchBar
          value={c.manualOrderId}
          onChange={c.setManualOrderId}
          placeholder="Ecwid order # (e.g. 12345)"
          autoFocus
          variant="blue"
          size="compact"
          hideUnderline
        />
        <SearchBar
          value={c.manualTitle}
          onChange={c.setManualTitle}
          placeholder="Product / repair description (optional)"
          variant="blue"
          size="compact"
          hideUnderline
          onSearch={() => {
            if (c.manualOrderId.trim()) void c.handleManualRepairSubmit();
          }}
        />
        <button
          type="button"
          disabled={c.manualSubmitting || c.submittingId != null || !c.manualOrderId.trim()}
          onClick={() => void c.handleManualRepairSubmit()}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-caption font-bold uppercase tracking-wider text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {c.manualSubmitting ? 'Linking…' : 'Link order'}
        </button>
      </div>
    );
  }

  return (
    <p className="px-3 pt-2 text-micro text-gray-500">
      Pick an order containing a repair-service SKU to link this carton.
    </p>
  );
}
