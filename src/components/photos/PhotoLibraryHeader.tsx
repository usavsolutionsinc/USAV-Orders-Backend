'use client';

import { Folder, Layers, Layout, LayoutDashboard, List } from '@/components/Icons';
import {
  mainStickyHeaderClass,
  mainStickyHeaderCompactRowClass,
  receivingHeaderHairlineClass,
} from '@/components/layout/header-shell';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { PhotoLibrarySortMode, PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import type { PhotoGridDensity } from '@/lib/photos/photo-grid-density';
import { cn } from '@/utils/_cn';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { PhotoGridDisplayControls } from './PhotoGridDisplayControls';
import { PhotoSortMenu } from './PhotoSortMenu';
import { photoLibraryControlButtonClass, photoLibraryControlGroupClass } from './photo-library-controls';
import type { FolderBrowseHeaderContext } from './photo-library-grid/date-folder-tree';

interface PhotoLibraryHeaderProps {
  title: string;
  metaLine: string;
  /** Folders view: level eyebrow + count, or leaf title + photo count. */
  folderBrowse?: FolderBrowseHeaderContext | null;
  view: PhotoLibraryViewMode;
  onViewChange: (view: PhotoLibraryViewMode) => void;
  sort: PhotoLibrarySortMode;
  onSortChange: (sort: PhotoLibrarySortMode) => void;
  gridDensity: PhotoGridDensity;
  onGridDensityChange: (density: PhotoGridDensity) => void;
  onRefreshPhotos?: () => void;
  isRefreshingPhotos?: boolean;
  /** When false, density + refresh are hidden (folder browse, list view, …). */
  showGridControls?: boolean;
  /**
   * Folders leaf: render controls in the breadcrumb bar instead of the header so
   * they sit beside the PO path. Flat grid views keep them in the header.
   */
  gridControlsInBreadcrumb?: boolean;
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
  folderBrowse,
  view,
  onViewChange,
  sort,
  onSortChange,
  gridDensity,
  onGridDensityChange,
  onRefreshPhotos,
  isRefreshingPhotos,
  showGridControls = true,
  gridControlsInBreadcrumb = false,
}: PhotoLibraryHeaderProps) {
  const renderGridControls =
    showGridControls && !gridControlsInBreadcrumb ? (
      <PhotoGridDisplayControls
        density={gridDensity}
        onDensityChange={onGridDensityChange}
        onRefresh={onRefreshPhotos}
        isRefreshing={isRefreshingPhotos}
      />
    ) : null;

  return (
    <div className={cn(mainStickyHeaderClass, receivingHeaderHairlineClass)}>
      <div className={mainStickyHeaderCompactRowClass}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {folderBrowse ? (
            <>
              <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span
                data-testid="folder-level"
                className="truncate text-eyebrow font-black uppercase tracking-widest text-gray-500"
              >
                {folderBrowse.title}
              </span>
              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-micro font-bold tabular-nums text-gray-500">
                {folderBrowse.count}
              </span>
              {folderBrowse.isLeaf && metaLine ? (
                <span className={`${microBadge} hidden truncate text-gray-500 sm:inline`}>{metaLine}</span>
              ) : null}
            </>
          ) : (
            <>
              <span className="truncate text-sm font-semibold text-gray-900">{title}</span>
              <span className={`${microBadge} hidden truncate text-gray-500 sm:inline`}>{metaLine}</span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <PhotoSortMenu sort={sort} onSortChange={onSortChange} />
          {renderGridControls}
          <div className={photoLibraryControlGroupClass} role="group" aria-label="Photo layout">
            {VIEW_OPTIONS.map(({ id, label, icon: Icon }) => {
              const active = view === id;
              return (
                <HoverTooltip key={id} label={label} asChild>
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={active}
                    onClick={() => onViewChange(id)}
                    className={cn('ds-raw-button', photoLibraryControlButtonClass(active, 'w-7'))}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                </HoverTooltip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
