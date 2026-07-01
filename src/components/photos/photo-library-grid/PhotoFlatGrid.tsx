'use client';

import type { PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import {
  photoGridLeafClass,
  photoGridTileProps,
  type PhotoGridDensity,
} from '@/lib/photos/photo-grid-density';
import { PhotoCard } from './PhotoCard';
import type { PhotoGridViewProps } from './types';

/**
 * grid-sm: dense square contact sheet. grid-lg: larger natural-aspect labeled
 * cards. BOTH are CSS grids so items flow left→right, top→bottom — i.e. the
 * active sort reads across rows. (grid-lg used CSS multi-column masonry, which
 * fills top→bottom DOWN each column, so chronological order ran down columns,
 * not across — `items-start` keeps the natural-height cards top-aligned.)
 */
export function PhotoFlatGrid({
  view,
  gridDensity,
  photos,
  scope,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  openAt,
}: PhotoGridViewProps & { view: PhotoLibraryViewMode; gridDensity: PhotoGridDensity }) {
  const showLabel = view === 'grid-lg';
  const containerClass = photoGridLeafClass(gridDensity);

  return (
    <div className={containerClass}>
      {photos.map((photo) => {
        const tile = photoGridTileProps(photo, gridDensity);
        return (
        <PhotoCard
          key={photo.id}
          photo={photo}
          imageUrl={tile.imageUrl}
          scope={scope}
          ratio={tile.ratio}
          showLabel={showLabel}
          selectionActive={selectionActive}
          selected={selected.has(photo.id)}
          onSelect={(mods) => onSelectTile(photo.id, mods)}
          onOpen={() => openAt(photo.id)}
          onContextMenu={onPhotoContextMenu}
        />
        );
      })}
    </div>
  );
}
