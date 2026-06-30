'use client';

import { type MouseEvent as ReactMouseEvent } from 'react';
import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { formatDateTimePST } from '@/utils/date';
import { cn } from '@/utils/_cn';
import { PhotoThumb } from '../PhotoThumb';
import { PhotoLabelChips } from '../PhotoLabelChips';
import { SelectionMark } from './SelectionMark';
import { clickSelectsInstead, photoPrimaryLabel } from './photo-grid-format';
import type { TileSelectMods } from './types';

/** A single tile — image + optional label footer — shared by every grid view. */
export function PhotoCard({
  photo,
  imageUrl,
  scope,
  ratio = 'square',
  showLabel,
  selectionActive,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  photo: LibraryPhoto;
  imageUrl: string;
  /** Source scope — drives the PO# vs Zendesk-ticket# label. */
  scope: PhotoLibrarySourceScope;
  ratio?: 'square' | 'natural';
  showLabel: boolean;
  selectionActive: boolean;
  selected: boolean;
  onSelect: (mods: TileSelectMods) => void;
  /** Open the shared fullscreen viewer at this photo (flat views only). */
  onOpen?: () => void;
  /** Right-click handler — surfaces the per-photo action menu. */
  onContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
}) {
  return (
    <div
      onContextMenu={onContextMenu ? (e) => onContextMenu(photo, e) : undefined}
      className={cn(
        // Selection is an INSET ring so the box never grows on select/deselect —
        // a non-inset ring paints 2px outside the tile and reads as the photo
        // jumping/toggling size in the grid.
        'group relative overflow-hidden rounded-lg border bg-white text-left transition-colors',
        selected ? 'border-primary ring-2 ring-inset ring-primary' : 'border-border hover:border-gray-300',
      )}
    >
      <SelectionMark
        checked={selected}
        active={selectionActive}
        onToggle={(mods) => onSelect(mods)}
      />
      <button
        type="button"
        data-testid="photo-tile"
        className="ds-raw-button block w-full text-left"
        onClick={(e) => {
          if (clickSelectsInstead(e, selectionActive)) {
            e.preventDefault();
            onSelect({ shift: e.shiftKey });
          } else {
            onOpen?.();
          }
        }}
      >
        <PhotoThumb
          src={imageUrl}
          alt={photoPrimaryLabel(photo, scope)}
          ratio={ratio}
          damage={Boolean(photo.damageDetected)}
        />
        {showLabel ? (
          <div className="space-y-1 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-caption font-semibold text-gray-900">
                  {photoPrimaryLabel(photo, scope)}
                </div>
                <div className="truncate text-micro text-gray-500">{formatDateTimePST(photo.createdAt)}</div>
              </div>
            </div>
            <PhotoLabelChips labels={photo.labels} max={3} />
          </div>
        ) : null}
      </button>
    </div>
  );
}
