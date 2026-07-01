'use client';

import { type MouseEvent as ReactMouseEvent } from 'react';
import { FileText } from '@/components/Icons';
import type { LibraryPhoto } from '../photo-library-types';
import { isLibraryDocument } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import type { PhotoGridTileRatio } from '@/lib/photos/photo-grid-density';
import { photoHeroLayoutId } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import { formatDateTimePST } from '@/utils/date';
import { cn } from '@/utils/_cn';
import { PhotoThumb } from '../PhotoThumb';
import { PhotoLabelChips } from '../PhotoLabelChips';
import { SelectionMark } from './SelectionMark';
import { clickSelectsInstead, photoPrimaryLabel, documentPrimaryLabel } from './photo-grid-format';
import type { TileSelectMods } from './types';

function documentTypeLabel(documentType?: string): string {
  if (documentType === 'shipping_label') return 'Shipping label';
  if (documentType === 'packing_slip') return 'Packing slip';
  return 'Document';
}

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
  ratio?: PhotoGridTileRatio;
  showLabel: boolean;
  selectionActive: boolean;
  selected: boolean;
  onSelect: (mods: TileSelectMods) => void;
  /** Open the shared fullscreen viewer at this photo (flat views only). */
  onOpen?: () => void;
  /** Right-click handler — surfaces the per-photo action menu. */
  onContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
}) {
  const isDocument = isLibraryDocument(photo);
  const primaryLabel = isDocument ? documentPrimaryLabel(photo) : photoPrimaryLabel(photo, scope);

  return (
    <div
      onContextMenu={onContextMenu && !isDocument ? (e) => onContextMenu(photo, e) : undefined}
      className={cn(
        // No `overflow-hidden` here — clipping lives on PhotoThumb itself
        // (matching `rounded-lg`) so the hero-morph shared-layout transform
        // (see PhotoThumb `heroId`) isn't cut off by this ancestor mid-animation;
        // it stays visually ON TOP of this border rather than clipped behind it.
        'group relative rounded-lg border bg-white text-left transition-colors',
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
        data-testid={isDocument ? 'document-tile' : 'photo-tile'}
        className="ds-raw-button block w-full text-left"
        onClick={(e) => {
          if (clickSelectsInstead(e, selectionActive)) {
            e.preventDefault();
            onSelect({ shift: e.shiftKey });
          } else if (isDocument) {
            window.open(imageUrl, '_blank', 'noopener,noreferrer');
          } else {
            onOpen?.();
          }
        }}
      >
        {isDocument ? (
          <div
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-2 bg-gray-50 px-3',
              showLabel ? 'rounded-t-lg' : 'rounded-lg',
            )}
          >
            <FileText className="h-10 w-10 text-gray-400" />
            <span className="text-center text-micro font-semibold text-gray-600">
              {documentTypeLabel(photo.documentType)}
            </span>
          </div>
        ) : (
          <PhotoThumb
            src={imageUrl}
            alt={primaryLabel}
            ratio={ratio}
            damage={Boolean(photo.damageDetected)}
            heroId={photoHeroLayoutId(photo.id)}
            // Only rounds the corners that sit at the CARD's own edge — top-only
            // when a label footer follows below, so the hero-morph transform
            // (unclipped by the ancestor, see the wrapper `div` above) still
            // matches the card's static rounded silhouette at rest.
            className={showLabel ? 'rounded-t-lg' : 'rounded-lg'}
          />
        )}
        {showLabel ? (
          <div className="space-y-1 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-caption font-semibold text-gray-900">{primaryLabel}</div>
                <div className="truncate text-micro text-gray-500">{formatDateTimePST(photo.createdAt)}</div>
              </div>
            </div>
            {!isDocument ? <PhotoLabelChips labels={photo.labels} max={3} /> : null}
          </div>
        ) : null}
      </button>
    </div>
  );
}
