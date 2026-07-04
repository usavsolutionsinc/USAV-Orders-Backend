'use client';

import { OrderSearchEmptyState } from '@/components/dashboard/OrderSearchEmptyState';
import { Button } from '@/design-system/primitives';

/** The subset of the search meta this empty state reads. */
export interface ShippedSearchMeta {
  outOfScope?: boolean;
  outOfScopeSuggestion?: { filter: string; count: number } | null;
}

export interface ShippedTableEmptyStateProps {
  /** Raw search string — when present, render the search empty state. */
  search: string;
  searchEmptyTitle: string;
  searchResultLabel: string;
  clearSearchLabel: string;
  onClearSearch: () => void;
  searchMeta: ShippedSearchMeta | null;
  /** Switch to the suggested type filter when the match is out of scope. */
  onApplySuggestedFilter: (filter: string) => void;
}

/**
 * Centered empty state for the shipped table. With an active search it shows
 * the {@link OrderSearchEmptyState} plus an optional "found N in the X tab —
 * switch?" affordance; otherwise the plain no-records-this-week message.
 */
export function ShippedTableEmptyState({
  search,
  searchEmptyTitle,
  searchResultLabel,
  clearSearchLabel,
  onClearSearch,
  searchMeta,
  onApplySuggestedFilter,
}: ShippedTableEmptyStateProps) {
  const suggestion = searchMeta?.outOfScope ? searchMeta.outOfScopeSuggestion : null;

  return (
    <div className="flex flex-col items-center justify-center py-40 text-center">
      {search ? (
        <>
          <OrderSearchEmptyState
            query={search}
            title={searchEmptyTitle}
            resultLabel={searchResultLabel}
            clearLabel={clearSearchLabel}
            onClear={onClearSearch}
          />
          {suggestion ? (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => onApplySuggestedFilter(suggestion.filter)}
              className="mt-4 h-auto whitespace-normal border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 hover:bg-amber-100"
            >
              Found {suggestion.count} match{suggestion.count === 1 ? '' : 'es'} in the <span className="uppercase">{suggestion.filter}</span> tab — switch?
            </Button>
          ) : null}
        </>
      ) : (
        <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
          <p className="text-text-soft font-semibold italic opacity-20">No shipped records for this week</p>
        </div>
      )}
    </div>
  );
}
