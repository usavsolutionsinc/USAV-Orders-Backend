'use client';

import { Folder, Layers, Layout, LayoutDashboard, List } from '@/components/Icons';
import {
  mainStickyHeaderClass,
  mainStickyHeaderCompactRowClass,
  receivingHeaderHairlineClass,
} from '@/components/layout/header-shell';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { PhotoLibrarySortMode, PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { cn } from '@/utils/_cn';
import { PhotoSortMenu } from './PhotoSortMenu';
import { photoLibraryControlButtonClass, photoLibraryControlGroupClass } from './photo-library-controls';

interface PhotoLibraryHeaderProps {
  title: string;
  metaLine: string;
  view: PhotoLibraryViewMode;
  onViewChange: (view: PhotoLibraryViewMode) => void;
  sort: PhotoLibrarySortMode;
  onSortChange: (sort: PhotoLibrarySortMode) => void;
}

const VIEW_OPTIONS: Array<{
  id: PhotoLibraryViewMode;
  label: string;
  icon: typeof Layout;
}> = [
  { id: 'grid-sm', label: 'Small grid', icon: Layout },
  { id: 'grid-lg', label: 'Large grid', icon: LayoutDashboard },
  { id: 'folders', label: 'Folders', icon: Folder },
  { id: 'grid-ticket', label: 'Group by ticket', icon: Layers },
  { id: 'list', label: 'List', icon: List },
];

export function PhotoLibraryHeader({
  title,
  metaLine,
  view,
  onViewChange,
  sort,
  onSortChange,
}: PhotoLibraryHeaderProps) {
  return (
    <div className={cn(mainStickyHeaderClass, receivingHeaderHairlineClass)}>
      <div className={mainStickyHeaderCompactRowClass}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-gray-900">{title}</span>
          <span className={`${microBadge} hidden truncate text-gray-500 sm:inline`}>{metaLine}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <PhotoSortMenu sort={sort} onSortChange={onSortChange} />
          <div className={photoLibraryControlGroupClass} role="group" aria-label="Photo layout">
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
                  className={photoLibraryControlButtonClass(active, 'w-7')}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
