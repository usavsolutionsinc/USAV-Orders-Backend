'use client';

import { Folder, List, Pencil } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { cn } from '@/utils/_cn';
import { photoLibraryControlButtonClass, photoLibraryControlGroupClass } from './photo-library-controls';

/**
 * Display mode switcher for the breadcrumb bar — Folders (or Select at a folder
 * leaf) plus List. Grid size is controlled separately on the third header row.
 */
export function PhotoLibraryViewToggle({
  view,
  onViewChange,
  folderIsLeaf,
  selectionActive,
  onToggleSelection,
}: {
  view: PhotoLibraryViewMode;
  onViewChange: (view: PhotoLibraryViewMode) => void;
  folderIsLeaf: boolean;
  selectionActive: boolean;
  onToggleSelection: () => void;
}) {
  const atFolderLeaf = view === 'folders' && folderIsLeaf;
  const listActive = view === 'list';

  return (
    <div className={photoLibraryControlGroupClass} role="group" aria-label="Photo layout">
      {atFolderLeaf ? (
        <HoverTooltip label={selectionActive ? 'Done selecting' : 'Select'} asChild>
          <button
            type="button"
            aria-label={selectionActive ? 'Done selecting' : 'Select'}
            aria-pressed={selectionActive}
            onClick={onToggleSelection}
            className={cn(
              'ds-raw-button',
              photoLibraryControlButtonClass(selectionActive, 'w-7'),
            )}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </HoverTooltip>
      ) : (
        <HoverTooltip label="Folders" asChild>
          <button
            type="button"
            aria-label="Folders"
            aria-pressed={view === 'folders'}
            onClick={() => onViewChange('folders')}
            className={cn('ds-raw-button', photoLibraryControlButtonClass(view === 'folders', 'w-7'))}
          >
            <Folder className="h-3.5 w-3.5" />
          </button>
        </HoverTooltip>
      )}

      <HoverTooltip label="List" asChild>
        <button
          type="button"
          aria-label="List"
          aria-pressed={listActive}
          onClick={() => onViewChange('list')}
          className={cn('ds-raw-button', photoLibraryControlButtonClass(listActive, 'w-7'))}
        >
          <List className="h-3.5 w-3.5" />
        </button>
      </HoverTooltip>
    </div>
  );
}
