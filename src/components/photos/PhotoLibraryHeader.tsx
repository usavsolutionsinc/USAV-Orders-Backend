'use client';

import {
  mainStickyHeaderClass,
  mainStickyHeaderCompactRowClass,
  receivingHeaderHairlineClass,
} from '@/components/layout/header-shell';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { PhotoLibrarySortMode, PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { cn } from '@/utils/_cn';
import { Folder } from '@/components/Icons';
import { PhotoSortMenu } from './PhotoSortMenu';
import { PhotoLibraryViewToggle } from './PhotoLibraryViewToggle';
import type { FolderBrowseHeaderContext } from './photo-library-grid/date-folder-tree';

interface PhotoLibraryHeaderProps {
  title: string;
  metaLine: string;
  /** Folders view: level eyebrow + count, or leaf title + photo count. */
  folderBrowse?: FolderBrowseHeaderContext | null;
  sort: PhotoLibrarySortMode;
  onSortChange: (sort: PhotoLibrarySortMode) => void;
  view: PhotoLibraryViewMode;
  onViewChange: (view: PhotoLibraryViewMode) => void;
  folderIsLeaf: boolean;
  onToggleSelection: () => void;
  /** Folders/List toggle — hidden while browsing year/month/week/day tiles. */
  showDisplayControls?: boolean;
}

/** Primary sticky header — context, sort, and Folders/List display toggle. */
export function PhotoLibraryHeader({
  title,
  metaLine,
  folderBrowse,
  sort,
  onSortChange,
  view,
  onViewChange,
  folderIsLeaf,
  onToggleSelection,
  showDisplayControls = true,
}: PhotoLibraryHeaderProps) {
  return (
    <div className={cn(mainStickyHeaderClass, receivingHeaderHairlineClass)}>
      <div className={mainStickyHeaderCompactRowClass}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {folderBrowse ? (
            <>
              <Folder className="h-3.5 w-3.5 shrink-0 text-text-faint" />
              <span
                data-testid="folder-level"
                className="truncate text-eyebrow font-black uppercase tracking-widest text-text-soft"
              >
                {folderBrowse.title}
              </span>
              <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-micro font-bold tabular-nums text-text-soft">
                {folderBrowse.count}
              </span>
              {folderBrowse.isLeaf && metaLine ? (
                <span className={`${microBadge} hidden truncate text-text-soft sm:inline`}>{metaLine}</span>
              ) : null}
            </>
          ) : (
            <>
              <span className="truncate text-sm font-semibold text-text-default">{title}</span>
              <span className={`${microBadge} hidden truncate text-text-soft sm:inline`}>{metaLine}</span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <PhotoSortMenu sort={sort} onSortChange={onSortChange} />
          {showDisplayControls ? (
            <PhotoLibraryViewToggle
              view={view}
              onViewChange={onViewChange}
              folderIsLeaf={folderIsLeaf}
              selectionActive={false}
              onToggleSelection={onToggleSelection}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
