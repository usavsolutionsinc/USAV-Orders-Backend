'use client';

/**
 * SearchRecentsDropdown — the "Recent searches" section of the global header
 * dropdown (docs/unified-global-search-consolidation-plan.md §2.1, §3.3).
 *
 * Presentational: the host owns storage (useSearchRecents) and placement (the
 * header AnchoredLayer). Rows are real links to each recent's re-run target
 * (recentRerunHref) so middle-click / new-tab behave, with an `onSelect` hook
 * so the host can also set the header value + close. House one-row anatomy
 * (title → meta → chips), no size shift on hover; the remove affordance is a
 * sibling button (never nested in the link).
 */

import Link from 'next/link';
import { Clock, Search, ChevronRight, X } from '@/components/Icons';
import { resolveSearchScopeLabel } from '@/lib/search/search-scope-labels';
import { recentRerunHref, formatRelativeTime, type SearchRecentEntry } from '@/lib/search/search-recents';
import { cn } from '@/utils/_cn';

export interface SearchRecentsDropdownProps {
  recents: SearchRecentEntry[];
  onSelect?: (entry: SearchRecentEntry) => void;
  onRemove?: (id: string) => void;
  onClearAll?: () => void;
  className?: string;
  /**
   * Combobox support (header dropdown only): the keyboard-highlighted row
   * index, and an id factory for role="option" / aria-activedescendant. When
   * omitted the list renders as a plain link list (operations sidebar usage).
   */
  activeIndex?: number;
  getOptionId?: (index: number) => string;
}

export function SearchRecentsDropdown({
  recents,
  onSelect,
  onRemove,
  onClearAll,
  className,
  activeIndex,
  getOptionId,
}: SearchRecentsDropdownProps) {
  if (recents.length === 0) return null;
  const asOptions = typeof getOptionId === 'function';

  return (
    <div className={className}>
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <p className="flex items-center gap-1.5 text-eyebrow font-black uppercase tracking-widest text-text-faint">
          <Clock className="h-3 w-3" />
          Recent searches
        </p>
        {onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="-my-0.5 text-eyebrow font-semibold uppercase tracking-widest text-text-faint hover:text-text-muted"
          >
            Clear
          </button>
        )}
      </div>
      <ul className="divide-y divide-border-hairline">
        {recents.map((entry, index) => {
          const label = entry.scopeLabel ?? resolveSearchScopeLabel(entry.scope);
          const active = asOptions && index === activeIndex;
          return (
            <li key={entry.id} className="group relative flex items-center">
              <Link
                href={recentRerunHref(entry)}
                onClick={() => onSelect?.(entry)}
                role={asOptions ? 'option' : undefined}
                id={asOptions ? getOptionId!(index) : undefined}
                aria-selected={active || undefined}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-hover',
                  active && 'bg-blue-50 ring-1 ring-inset ring-blue-400',
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <Search className="h-4 w-4 text-text-faint" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-bold text-text-default">
                    {entry.query}
                  </span>
                  <span className="flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                    <span className="truncate">{label}</span>
                    <span className="text-text-faint">·</span>
                    <span className="shrink-0 text-text-faint">{formatRelativeTime(entry.timestamp)}</span>
                  </span>
                </span>
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-text-faint transition-opacity',
                    onRemove ? 'opacity-0 group-hover:opacity-0' : 'opacity-0 group-hover:opacity-100',
                  )}
                />
              </Link>
              {onRemove && (
                <button
                  type="button"
                  aria-label={`Remove recent search “${entry.query}”`}
                  onClick={() => onRemove(entry.id)}
                  className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-md text-text-faint opacity-0 transition-opacity hover:bg-surface-sunken hover:text-text-muted group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
