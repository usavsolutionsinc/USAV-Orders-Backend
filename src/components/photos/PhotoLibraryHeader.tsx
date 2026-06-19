'use client';

import { ChevronLeft, ChevronRight, Layout, LayoutDashboard, List } from '@/components/Icons';
import {
  mainStickyHeaderClass,
  mainStickyHeaderCompactRowClass,
  receivingHeaderHairlineClass,
} from '@/components/layout/header-shell';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { cn } from '@/utils/_cn';

interface PhotoLibraryHeaderProps {
  title: string;
  metaLine: string;
  view: PhotoLibraryViewMode;
  onViewChange: (view: PhotoLibraryViewMode) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}

const VIEW_OPTIONS: Array<{
  id: PhotoLibraryViewMode;
  label: string;
  icon: typeof Layout;
}> = [
  { id: 'grid-sm', label: 'Small grid', icon: Layout },
  { id: 'grid-lg', label: 'Large grid', icon: LayoutDashboard },
  { id: 'list', label: 'List', icon: List },
];

export function PhotoLibraryHeader({
  title,
  metaLine,
  view,
  onViewChange,
  page,
  totalPages,
  onPageChange,
  isLoading,
}: PhotoLibraryHeaderProps) {
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className={cn(mainStickyHeaderClass, receivingHeaderHairlineClass)}>
      <div className={mainStickyHeaderCompactRowClass}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-gray-900">{title}</span>
          <span className={`${microBadge} hidden truncate text-gray-500 sm:inline`}>{metaLine}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div
            className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5"
            role="group"
            aria-label="Photo layout"
          >
            {VIEW_OPTIONS.map(({ id, label, icon: Icon }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => onViewChange(id)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          <div className="ml-1 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={!canPrev || isLoading}
              onClick={() => onPageChange(page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[3.25rem] text-center text-micro font-bold tabular-nums text-gray-600">
              {isLoading ? '…' : `${page}/${Math.max(totalPages, 1)}`}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={!canNext || isLoading}
              onClick={() => onPageChange(page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
