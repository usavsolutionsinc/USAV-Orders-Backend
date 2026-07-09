'use client';

import { Button } from '@/design-system/primitives';
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
    <section className="border-y border-border-soft">
      <div className="flex items-center justify-between gap-3 px-0 py-2 border-b border-border-soft">
        <p className={sectionLabel}>Recent Searches</p>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className={`${microBadge} h-auto rounded-none px-0 py-0 text-text-soft hover:bg-transparent hover:text-text-muted`}
          >
            Clear All
          </Button>
          {totalCount > 3 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleExpanded}
              className={`${microBadge} h-auto rounded-none px-0 py-0 text-blue-600 hover:bg-transparent hover:text-blue-700`}
            >
              {expanded ? 'Show Less' : 'Show All'}
            </Button>
          ) : null}
        </div>
      </div>
      <div>
        {/* ds-raw-button: full-width list/picker rows (title + meta, conditional divider) — not the Button primitive shape */}
        {items.map((item, index) => (
          <button
            key={`${item.query}-${index}`}
            type="button"
            onClick={() => onSelect(item.query)}
            className={`ds-raw-button flex w-full items-center justify-between gap-3 px-0 py-2.5 text-left ${
              index < items.length - 1 ? 'border-b border-border-soft' : ''
            }`}
          >
            <span className="truncate text-caption font-semibold text-text-default">
              {getDisplayQuery ? getDisplayQuery(item) : item.query}
            </span>
            <span className={`shrink-0 ${microBadge} text-text-soft`}>
              {getMetaLabel ? getMetaLabel(item) : 'Reuse'}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
