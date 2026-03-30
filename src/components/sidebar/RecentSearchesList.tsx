'use client';

import { sectionLabel, microBadge } from '@/design-system/tokens/typography/presets';

interface RecentSearchItem {
  query: string;
  resultCount?: number;
}

interface RecentSearchesListProps {
  items: RecentSearchItem[];
  totalCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelect: (query: string) => void;
  onClear: () => void;
  getDisplayQuery?: (item: RecentSearchItem) => string;
  getMetaLabel?: (item: RecentSearchItem) => string | null;
}

export function RecentSearchesList({
  items,
  totalCount,
  expanded,
  onToggleExpanded,
  onSelect,
  onClear,
  getDisplayQuery,
  getMetaLabel,
}: RecentSearchesListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="border-y border-gray-200">
      <div className="flex items-center justify-between gap-3 px-0 py-2 border-b border-gray-200">
        <p className={sectionLabel}>Recent Searches</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClear}
            className={`${microBadge} text-gray-500 transition-colors hover:text-gray-600`}
          >
            Clear All
          </button>
          {totalCount > 3 ? (
            <button
              type="button"
              onClick={onToggleExpanded}
              className={`${microBadge} text-blue-600 transition-colors hover:text-blue-700`}
            >
              {expanded ? 'Show Less' : 'Show All'}
            </button>
          ) : null}
        </div>
      </div>
      <div>
        {items.map((item, index) => (
          <button
            key={`${item.query}-${index}`}
            type="button"
            onClick={() => onSelect(item.query)}
            className={`flex w-full items-center justify-between gap-3 px-0 py-2.5 text-left ${
              index < items.length - 1 ? 'border-b border-gray-200' : ''
            }`}
          >
            <span className="truncate text-[11px] font-semibold text-gray-900">
              {getDisplayQuery ? getDisplayQuery(item) : item.query}
            </span>
            <span className={`shrink-0 ${microBadge} text-gray-500`}>
              {getMetaLabel ? getMetaLabel(item) : 'Reuse'}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
