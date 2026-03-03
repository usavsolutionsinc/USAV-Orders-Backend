'use client';

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
    <section>
      <div className="flex items-center justify-between gap-3 px-1 py-2">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-500">Recent Searches</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClear}
            className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400 transition-colors hover:text-gray-600"
          >
            Clear All
          </button>
          {totalCount > 3 ? (
            <button
              type="button"
              onClick={onToggleExpanded}
              className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-600 transition-colors hover:text-blue-700"
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
            className={`flex w-full items-center justify-between gap-3 px-1 py-3 text-left transition-colors hover:bg-slate-50 ${
              index < items.length - 1 ? 'border-b border-gray-100' : ''
            }`}
          >
            <span className="truncate text-[11px] font-semibold text-gray-900">
              {getDisplayQuery ? getDisplayQuery(item) : item.query}
            </span>
            <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.18em] text-gray-400">
              {getMetaLabel ? getMetaLabel(item) : 'Reuse'}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
